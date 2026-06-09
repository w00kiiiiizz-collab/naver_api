import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

function generateSignature(timestamp, method, uri, secretKey) {
  const message = `${timestamp}.${method}.${uri}`;
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

async function makeNaverRequest(uri, method, customerId, queryParams) {
  const apiKey = process.env.NAVER_API_KEY;
  const secretKey = process.env.NAVER_SECRET_KEY;
  const baseUrl = 'https://api.searchad.naver.com';
  const timestamp = Date.now().toString();
  const signature = generateSignature(timestamp, method, uri, secretKey);

  const headers = {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Timestamp': timestamp,
    'X-API-KEY': apiKey,
    'X-Customer': customerId,
    'X-Signature': signature
  };

  const fullUrl = queryParams ? `${baseUrl}${uri}?${queryParams}` : `${baseUrl}${uri}`;
  const response = await fetch(fullUrl, { method, headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Naver API Error ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

function getYesterdayString() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  const offset = date.getTimezoneOffset() * 60000;
  const localISOTime = (new Date(date - offset)).toISOString().split('T')[0];
  return localISOTime;
}

function getAdName(adObj) {
  if (adObj.referenceData && (adObj.referenceData.productName || adObj.referenceData.productTitle)) {
    return adObj.referenceData.productName || adObj.referenceData.productTitle;
  }
  if (adObj.ad && adObj.ad.headline) {
    return adObj.ad.headline;
  }
  return adObj.nccAdId;
}

function getAdImageUrl(adObj) {
  if (adObj.referenceData && adObj.referenceData.imageUrl) {
    return adObj.referenceData.imageUrl;
  }
  return null;
}

async function fetchStatsInBatches(ids, customerId, statDateStr, entityType) {
  const fieldsArray = ["impCnt","clkCnt","ctr","cpc","salesAmt","purchaseCcnt","purchaseConvAmt","purchaseRor","cpConv"];
  const allStatsToUpsert = [];
  const chunkSize = 100;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const queryParams = new URLSearchParams({
      ids: chunk.join(','),
      datePreset: 'yesterday',
      fields: JSON.stringify(fieldsArray)
    }).toString();

    try {
      const stats = await makeNaverRequest('/stats', 'GET', customerId, queryParams);
      if (stats && stats.data) {
        for (const statData of stats.data) {
          const baseStat = {
            stat_date: statDateStr,
            imp_cnt: statData.impCnt || 0,
            clk_cnt: statData.clkCnt || 0,
            ctr: statData.ctr || 0,
            cpc: statData.cpc || 0,
            sales_amt: statData.salesAmt || 0,
            purchase_ccnt: statData.purchaseCcnt || 0,
            purchase_conv_amt: statData.purchaseConvAmt || 0,
            purchase_ror: statData.purchaseRor || 0,
            cp_conv: statData.cpConv || 0
          };

          if (entityType === 'campaign') {
            allStatsToUpsert.push({ ...baseStat, ncc_campaign_id: statData.id });
          } else if (entityType === 'adgroup') {
            allStatsToUpsert.push({ ...baseStat, ncc_adgroup_id: statData.id });
          } else if (entityType === 'ad') {
            allStatsToUpsert.push({ ...baseStat, ncc_ad_id: statData.id });
          } else if (entityType === 'keyword') {
            allStatsToUpsert.push({ ...baseStat, ncc_keyword_id: statData.id });
          }
        }
      }
    } catch (err) {
      console.error(`Failed to fetch stats for batch of ${entityType}:`, err.message);
    }
  }

  return allStatsToUpsert;
}

async function runSync() {
  const customerId = process.env.NAVER_CUSTOMER_ID;
  console.log(`Starting sync for master customer ID: ${customerId}`);
  
  const managerRes = await makeNaverRequest('/manager-accounts', 'GET', customerId);
  let managerIds = [];
  if (Array.isArray(managerRes)) {
    managerIds = managerRes.map(m => m.managerAccountNo);
  } else if (managerRes.content && Array.isArray(managerRes.content)) {
    managerIds = managerRes.content.map(m => m.managerAccountNo);
  }
  
  if (managerIds.length === 0) {
    managerIds.push(parseInt(customerId, 10));
  }
  
  const statDateStr = getYesterdayString();

  const allCampaignIds = [];
  const allAdgroupsData = []; // Let's keep IDs
  const allAdgroupIds = [];
  const allAdIds = [];
  const allKeywordIds = [];

  for (const mId of managerIds) {
    console.log(`Fetching child accounts for ${mId}...`);
    let childAccounts = [];
    try {
      const res = await makeNaverRequest(`/manager-accounts/${mId}/child-ad-accounts`, 'GET', customerId);
      if (Array.isArray(res)) childAccounts = res;
      else if (res && Array.isArray(res.content)) childAccounts = res.content;
    } catch (err) {
      console.error(`Failed to fetch child accounts for manager ${mId}:`, err.message);
      continue;
    }

    if (childAccounts.length === 0) continue;

    for (const account of childAccounts) {
      console.log(`Syncing child account: ${account.adAccountName} (${account.customerId})`);
      await supabaseAdmin.from('ad_accounts').upsert({
        customer_id: account.customerId,
        ad_account_no: account.adAccountNo,
        ad_account_name: account.adAccountName,
        manager_account_no: mId
      });

      let campaigns = [];
      try {
        campaigns = await makeNaverRequest('/ncc/campaigns', 'GET', account.customerId.toString());
      } catch (err) {
        console.error(`Failed to fetch campaigns for account ${account.adAccountName}:`, err.message);
        continue;
      }

      if (!Array.isArray(campaigns)) continue;

      for (const camp of campaigns) {
        await supabaseAdmin.from('campaigns').upsert({
          ncc_campaign_id: camp.nccCampaignId,
          customer_id: account.customerId,
          name: camp.name,
          status: camp.status
        });
        allCampaignIds.push(camp.nccCampaignId);

        // Fetch Ad Groups
        let adgroups = [];
        try {
          adgroups = await makeNaverRequest('/ncc/adgroups', 'GET', account.customerId.toString(), `nccCampaignId=${camp.nccCampaignId}`);
        } catch (err) {
          console.error(`Failed to fetch adgroups for campaign ${camp.nccCampaignId}:`, err.message);
          continue;
        }

        if (!Array.isArray(adgroups)) continue;

        for (const adg of adgroups) {
          await supabaseAdmin.from('ad_groups').upsert({
            ncc_adgroup_id: adg.nccAdgroupId,
            ncc_campaign_id: camp.nccCampaignId,
            customer_id: account.customerId,
            name: adg.name,
            status: adg.status
          });
          allAdgroupIds.push(adg.nccAdgroupId);

          // Fetch Ads
          let ads = [];
          try {
            ads = await makeNaverRequest('/ncc/ads', 'GET', account.customerId.toString(), `nccAdgroupId=${adg.nccAdgroupId}`);
          } catch (err) {
            console.error(`Failed to fetch ads for adgroup ${adg.nccAdgroupId}:`, err.message);
            continue;
          }

          if (!Array.isArray(ads)) continue;

          for (const adObj of ads) {
            await supabaseAdmin.from('ads').upsert({
              ncc_ad_id: adObj.nccAdId,
              ncc_adgroup_id: adg.nccAdgroupId,
              ncc_campaign_id: camp.nccCampaignId,
              customer_id: account.customerId,
              name: getAdName(adObj),
              type: adObj.type,
              image_url: getAdImageUrl(adObj),
              status: adObj.status
            });
            allAdIds.push(adObj.nccAdId);
          }

          // Fetch Keywords
          let keywords = [];
          try {
            keywords = await makeNaverRequest('/ncc/keywords', 'GET', account.customerId.toString(), `nccAdgroupId=${adg.nccAdgroupId}`);
          } catch (err) {
            console.error(`Failed to fetch keywords for adgroup ${adg.nccAdgroupId}:`, err.message);
          }

          if (Array.isArray(keywords)) {
            for (const kw of keywords) {
              await supabaseAdmin.from('keywords').upsert({
                ncc_keyword_id: kw.nccKeywordId,
                ncc_adgroup_id: adg.nccAdgroupId,
                ncc_campaign_id: camp.nccCampaignId,
                customer_id: account.customerId,
                keyword: kw.keyword,
                status: kw.status
              });
              allKeywordIds.push(kw.nccKeywordId);
            }
          }
        }
      }

      // Fetch stats for all levels in batches
      console.log(`Syncing stats for customer ${account.adAccountName}...`);

      if (allCampaignIds.length > 0) {
        const campStats = await fetchStatsInBatches(allCampaignIds, account.customerId.toString(), statDateStr, 'campaign');
        if (campStats.length > 0) {
          await supabaseAdmin.from('campaign_stats').upsert(campStats, { onConflict: 'ncc_campaign_id, stat_date' });
        }
      }

      if (allAdgroupIds.length > 0) {
        const adgStats = await fetchStatsInBatches(allAdgroupIds, account.customerId.toString(), statDateStr, 'adgroup');
        if (adgStats.length > 0) {
          await supabaseAdmin.from('ad_group_stats').upsert(adgStats, { onConflict: 'ncc_adgroup_id, stat_date' });
        }
      }

      if (allAdIds.length > 0) {
        const adStats = await fetchStatsInBatches(allAdIds, account.customerId.toString(), statDateStr, 'ad');
        if (adStats.length > 0) {
          await supabaseAdmin.from('ad_stats').upsert(adStats, { onConflict: 'ncc_ad_id, stat_date' });
        }
      }

      if (allKeywordIds.length > 0) {
        const kwStats = await fetchStatsInBatches(allKeywordIds, account.customerId.toString(), statDateStr, 'keyword');
        if (kwStats.length > 0) {
          await supabaseAdmin.from('keyword_stats').upsert(kwStats, { onConflict: 'ncc_keyword_id, stat_date' });
        }
      }

      // Clear for next loop
      allCampaignIds.length = 0;
      allAdgroupIds.length = 0;
      allAdIds.length = 0;
      allKeywordIds.length = 0;
    }
  }
  console.log('Sync finished completely!');
}

runSync();
