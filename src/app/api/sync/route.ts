import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { makeNaverRequest } from '@/lib/naver';
import { format, subDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

function getAdName(adObj: any) {
  if (adObj.referenceData && (adObj.referenceData.productName || adObj.referenceData.productTitle)) {
    return adObj.referenceData.productName || adObj.referenceData.productTitle;
  }
  if (adObj.ad && adObj.ad.headline) {
    return adObj.ad.headline;
  }
  return adObj.nccAdId;
}

function getAdImageUrl(adObj: any) {
  if (adObj.referenceData && adObj.referenceData.imageUrl) {
    return adObj.referenceData.imageUrl;
  }
  return null;
}

async function fetchStatsInBatches(
  ids: string[],
  customerId: string,
  statDateStr: string,
  entityType: 'campaign' | 'adgroup' | 'ad' | 'keyword'
) {
  const fieldsArray = ["impCnt","clkCnt","ctr","cpc","salesAmt","purchaseCcnt","purchaseConvAmt","purchaseRor","cpConv"];
  const allStatsToUpsert: any[] = [];
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
      console.error(`Failed to fetch stats for batch of ${entityType}:`, err);
    }
  }

  return allStatsToUpsert;
}

export async function GET() {
  try {
    console.log('Starting Naver API sync (Hierarchy + Stats)...');
    const customerId = process.env.NAVER_CUSTOMER_ID!;
    
    // 1. Fetch Manager Accounts
    const managerRes = await makeNaverRequest('/manager-accounts', 'GET', customerId);
    let managerAccounts: any[] = [];
    if (managerRes && Array.isArray(managerRes.content)) {
      managerAccounts = managerRes.content;
    }
    
    const managerIds = managerAccounts.map(m => m.managerAccountNo);
    if (managerIds.length === 0) {
      managerIds.push(parseInt(customerId, 10));
    }

    // Determine 'yesterday' in KST
    const kstTimeZone = 'Asia/Seoul';
    const nowKst = toZonedTime(new Date(), kstTimeZone);
    const yesterdayKst = subDays(nowKst, 1);
    const statDateStr = format(yesterdayKst, 'yyyy-MM-dd'); // e.g. 2026-06-08

    const allCampaignIds: string[] = [];
    const allAdgroupIds: string[] = [];
    const allAdIds: string[] = [];
    const allKeywordIds: string[] = [];

    // 2. Fetch Child Accounts for each Manager
    for (const mId of managerIds) {
      let childAccounts: any[] = [];
      try {
        const res = await makeNaverRequest(`/manager-accounts/${mId}/child-ad-accounts`, 'GET', customerId);
        if (Array.isArray(res)) {
          childAccounts = res;
        } else if (res && Array.isArray(res.content)) {
          childAccounts = res.content;
        }
      } catch (err) {
        console.error(`Failed to fetch child accounts for manager ${mId}`);
        continue;
      }
      
      if (childAccounts.length === 0) continue;

      for (const account of childAccounts) {
        // Upsert Ad Account
        await supabaseAdmin.from('ad_accounts').upsert({
          customer_id: account.customerId,
          ad_account_no: account.adAccountNo,
          ad_account_name: account.adAccountName,
          manager_account_no: mId
        });

        // 3. Fetch Campaigns for this child account
        let campaigns: any[] = [];
        try {
          campaigns = await makeNaverRequest('/ncc/campaigns', 'GET', account.customerId.toString());
        } catch (err) {
          console.error(`Failed to fetch campaigns for customer ${account.customerId}`);
          continue;
        }

        if (!Array.isArray(campaigns)) continue;

        for (const camp of campaigns) {
          // Upsert Campaign
          await supabaseAdmin.from('campaigns').upsert({
            ncc_campaign_id: camp.nccCampaignId,
            customer_id: account.customerId,
            name: camp.name,
            status: camp.status
          });
          allCampaignIds.push(camp.nccCampaignId);

          // 4. Fetch Ad Groups for this Campaign
          let adgroups: any[] = [];
          try {
            adgroups = await makeNaverRequest('/ncc/adgroups', 'GET', account.customerId.toString(), `nccCampaignId=${camp.nccCampaignId}`);
          } catch (err) {
            console.error(`Failed to fetch adgroups for campaign ${camp.nccCampaignId}`);
            continue;
          }

          if (!Array.isArray(adgroups)) continue;

          for (const adg of adgroups) {
            // Upsert Ad Group
            await supabaseAdmin.from('ad_groups').upsert({
              ncc_adgroup_id: adg.nccAdgroupId,
              ncc_campaign_id: camp.nccCampaignId,
              customer_id: account.customerId,
              name: adg.name,
              status: adg.status
            });
            allAdgroupIds.push(adg.nccAdgroupId);

            // 5. Fetch Ads for this Ad Group
            let ads: any[] = [];
            try {
              ads = await makeNaverRequest('/ncc/ads', 'GET', account.customerId.toString(), `nccAdgroupId=${adg.nccAdgroupId}`);
            } catch (err) {
              console.error(`Failed to fetch ads for adgroup ${adg.nccAdgroupId}`);
              continue;
            }

            if (!Array.isArray(ads)) continue;

            for (const adObj of ads) {
              // Upsert Ad
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

            // Fetch Keywords for this Ad Group
            let keywords: any[] = [];
            try {
              keywords = await makeNaverRequest('/ncc/keywords', 'GET', customerId, `nccAdgroupId=${adg.nccAdgroupId}`);
            } catch (err) {
              console.error(`Failed to fetch keywords for adgroup ${adg.nccAdgroupId}`);
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

        // Fetch and upsert stats for this child account in batches to respect headers
        console.log(`Syncing stats for customer ${account.adAccountName} (${account.customerId})...`);
        
        // Campaign stats
        const campStats = await fetchStatsInBatches(allCampaignIds, account.customerId.toString(), statDateStr, 'campaign');
        if (campStats.length > 0) {
          await supabaseAdmin.from('campaign_stats').upsert(campStats, { onConflict: 'ncc_campaign_id, stat_date' });
        }

        // Ad Group stats
        const adgStats = await fetchStatsInBatches(allAdgroupIds, account.customerId.toString(), statDateStr, 'adgroup');
        if (adgStats.length > 0) {
          await supabaseAdmin.from('ad_group_stats').upsert(adgStats, { onConflict: 'ncc_adgroup_id, stat_date' });
        }

        // Ad stats
        const adStats = await fetchStatsInBatches(allAdIds, account.customerId.toString(), statDateStr, 'ad');
        if (adStats.length > 0) {
          await supabaseAdmin.from('ad_stats').upsert(adStats, { onConflict: 'ncc_ad_id, stat_date' });
        }

        // Keyword stats
        if (allKeywordIds.length > 0) {
          const kwStats = await fetchStatsInBatches(allKeywordIds, account.customerId.toString(), statDateStr, 'keyword');
          if (kwStats.length > 0) {
            await supabaseAdmin.from('keyword_stats').upsert(kwStats, { onConflict: 'ncc_keyword_id, stat_date' });
          }
        }

        // Clear arrays for the next child account
        allCampaignIds.length = 0;
        allAdgroupIds.length = 0;
        allAdIds.length = 0;
        allKeywordIds.length = 0;
      }
    }

    return NextResponse.json({ success: true, message: `Synced full hierarchy and stats for ${statDateStr}` });
  } catch (error: any) {
    console.error('Sync Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
