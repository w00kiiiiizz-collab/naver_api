import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { makeNaverRequest, generateSignature } from '@/lib/naver';
import { parseISO, differenceInDays, addDays, format } from 'date-fns';

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

async function fetchStatsInBatchesForDate(
  ids: string[],
  customerId: string,
  dateStr: string,
  entityType: 'campaign' | 'adgroup' | 'ad' | 'keyword',
  customKeys?: { apiKey: string; secretKey: string }
) {
  const fieldsArray = ["impCnt","clkCnt","ctr","cpc","salesAmt","purchaseCcnt","purchaseConvAmt","purchaseRor","cpConv"];
  const allStatsToUpsert: any[] = [];
  const chunkSize = 100;
  const timeRange = JSON.stringify({ since: dateStr, until: dateStr });

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const queryParams = new URLSearchParams({
      ids: chunk.join(','),
      timeRange: timeRange,
      fields: JSON.stringify(fieldsArray)
    }).toString();

    try {
      const stats = await makeNaverRequest('/stats', 'GET', customerId, queryParams, customKeys);
      if (stats && stats.data) {
        for (const statData of stats.data) {
          const baseStat = {
            stat_date: dateStr,
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
      console.error(`Failed to fetch stats for date ${dateStr} batch of ${entityType}:`, err);
    }
  }

  return allStatsToUpsert;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function mapConcurrent<T, R>(items: T[], limit: number, delayMs: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
      if (delayMs > 0 && index < items.length) {
        await sleep(delayMs);
      }
    }
  }
  
  // Stagger worker start times to spread requests evenly
  const workers = Array.from({ length: Math.min(limit, items.length) }, async (_, idx) => {
    if (delayMs > 0 && idx > 0) {
      await sleep(idx * Math.floor(delayMs / limit));
    }
    await worker();
  });
  
  await Promise.all(workers);
  return results;
}

if (!(global as any).activeSyncs) {
  (global as any).activeSyncs = new Map<string, { status: 'running' | 'success' | 'failed', error?: string }>();
}
const activeSyncs = (global as any).activeSyncs;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get('customerId');
  const startDateStr = searchParams.get('startDate');
  const endDateStr = searchParams.get('endDate') || startDateStr;
  const force = searchParams.get('force') === 'true';
  const checkStatus = searchParams.get('status') === 'true';
  const syncHierarchy = searchParams.get('syncHierarchy') === 'true';
  const syncMode = searchParams.get('syncMode');

  if (!customerId) {
    return NextResponse.json({ success: false, error: 'Missing customerId' }, { status: 400 });
  }

  if (checkStatus) {
    const syncState = activeSyncs.get(customerId) || { status: 'idle' };
    return NextResponse.json({ success: true, ...syncState });
  }

  if (!startDateStr) {
    return NextResponse.json({ success: false, error: 'Missing startDate' }, { status: 400 });
  }

  // Check if sync is already running for this customer
  const currentSync = activeSyncs.get(customerId);
  if (currentSync && currentSync.status === 'running') {
    return NextResponse.json({ success: true, message: 'Sync already running', status: 'running' });
  }

  // Set state to running
  activeSyncs.set(customerId, { status: 'running' });

  const runSyncAction = async () => {
    try {
      console.log(`[Background Sync] Starting for customer ${customerId} from ${startDateStr} to ${endDateStr} (force: ${force}, syncHierarchy: ${syncHierarchy})`);
      
      const customerIdInt = parseInt(customerId, 10);
      
      // Fetch Naver API keys from user_profiles if they exist for this customerId
      let customKeys: { apiKey: string; secretKey: string } | undefined;
      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('naver_api_key, naver_secret_key')
        .eq('naver_customer_id', customerIdInt)
        .maybeSingle();

      if (profile && profile.naver_api_key && profile.naver_secret_key) {
        customKeys = {
          apiKey: profile.naver_api_key,
          secretKey: profile.naver_secret_key
        };
        console.log(`[Background Sync] Using custom Naver API keys for customer ${customerId}`);
      } else {
        console.log(`[Background Sync] Using default master Naver API keys for customer ${customerId}`);
      }

      const start = parseISO(startDateStr);
      const end = parseISO(endDateStr!);
      const totalDays = differenceInDays(end, start);

      if (totalDays < 0 || totalDays > 31) {
        throw new Error('Invalid date range');
      }

      // --- CHECK ALREADY SYNCED DATES ---
      let syncedDateSet = new Set<string>();
      if (!force) {
        const { data: alreadySynced } = await supabaseAdmin
          .from('synced_dates')
          .select('synced_date')
          .eq('customer_id', customerIdInt)
          .gte('synced_date', startDateStr)
          .lte('synced_date', endDateStr);

        syncedDateSet = new Set(alreadySynced?.map((d: any) => d.synced_date) || []);
      }
      
      const datesToSync: string[] = [];
      for (let d = 0; d <= totalDays; d++) {
        const dateStr = format(addDays(start, d), 'yyyy-MM-dd');
        if (!syncedDateSet.has(dateStr)) {
          datesToSync.push(dateStr);
        }
      }

      if (datesToSync.length === 0) {
        console.log(`[Background Sync] All dates already synced for customer ${customerId}`);
        activeSyncs.set(customerId, { status: 'success' });
        return;
      }

      console.log(`[Background Sync] Need to sync dates: ${datesToSync.join(', ')}`);

      let runFullHierarchySync = syncHierarchy;

      let campaigns: any[] = [];
      let ads: any[] = [];
      let keywords: any[] = [];
      let allCampaignIds: string[] = [];
      let allAdgroupIds: string[] = [];
      let allAdIds: string[] = [];
      let allKeywordIds: string[] = [];

      if (!runFullHierarchySync) {
        console.log(`[Background Sync] stats-only sync requested. Checking database for existing hierarchy...`);
        
        try {
          // Always fetch campaigns from Naver API to keep types updated
          const apiCampaigns = await makeNaverRequest('/ncc/campaigns', 'GET', customerId, undefined, customKeys);
          if (Array.isArray(apiCampaigns) && apiCampaigns.length > 0) {
            campaigns = apiCampaigns.map(c => ({
              nccCampaignId: c.nccCampaignId,
              name: c.name,
              status: c.status,
              campaignTp: c.campaignTp
            }));
            allCampaignIds = campaigns.map(c => c.nccCampaignId);

            // Update campaigns table in DB with the API campaigns (updates types)
            const campaignRows = apiCampaigns.map(camp => ({
              ncc_campaign_id: camp.nccCampaignId,
              customer_id: customerIdInt,
              name: camp.name,
              status: camp.status,
              type: camp.campaignTp
            }));
            await supabaseAdmin.from('campaigns').upsert(campaignRows);
            console.log(`[Background Sync] Refreshed campaign types from Naver API: ${campaigns.length} campaigns`);
          }
        } catch (err: any) {
          console.error(`[Background Sync] Failed to refresh campaigns from Naver API, falling back to DB:`, err.message);
        }

        // If API campaigns fetch failed or returned empty, fallback to DB campaigns
        if (campaigns.length === 0) {
          // Fetch campaigns from database
          const { data: dbCampaigns, error: campErr } = await supabaseAdmin
            .from('campaigns')
            .select('ncc_campaign_id, name, status, type')
            .eq('customer_id', customerIdInt);
          
          if (campErr || !dbCampaigns || dbCampaigns.length === 0) {
            console.log(`[Background Sync] No existing campaigns in database for customer ${customerId}. Falling back to full hierarchy sync.`);
            runFullHierarchySync = true;
          } else {
            campaigns = dbCampaigns.map(c => ({
              nccCampaignId: c.ncc_campaign_id,
              name: c.name,
              status: c.status,
              campaignTp: c.type
            }));
            allCampaignIds = campaigns.map(c => c.nccCampaignId);
          }
        }

        if (campaigns.length > 0 && !runFullHierarchySync) {
          // Fetch existing adgroups
          const { data: dbAdGroups, error: adgErr } = await supabaseAdmin
            .from('ad_groups')
            .select('ncc_adgroup_id')
            .eq('customer_id', customerIdInt);
          
          if (adgErr || !dbAdGroups || dbAdGroups.length === 0) {
            console.log(`[Background Sync] No existing ad groups in database for customer ${customerId}. Falling back to full hierarchy sync.`);
            runFullHierarchySync = true;
          } else {
            allAdgroupIds = dbAdGroups.map(a => a.ncc_adgroup_id);

            // Fetch existing ads
            const { data: dbAds } = await supabaseAdmin
              .from('ads')
              .select('ncc_ad_id')
              .eq('customer_id', customerIdInt);
            allAdIds = dbAds?.map(a => a.ncc_ad_id) || [];

            // Fetch existing keywords
            const { data: dbKeywords } = await supabaseAdmin
              .from('keywords')
              .select('ncc_keyword_id')
              .eq('customer_id', customerIdInt);
            allKeywordIds = dbKeywords?.map(k => k.ncc_keyword_id) || [];

            console.log(`[Background Sync] Database hierarchy loaded: ${allCampaignIds.length} campaigns, ${allAdgroupIds.length} adgroups, ${allAdIds.length} ads, ${allKeywordIds.length} keywords`);
          }
        }
      }

      if (runFullHierarchySync) {
        console.log(`[Background Sync] Running full hierarchy sync from Naver API...`);

        // 1. Fetch campaigns for this customer
        campaigns = await makeNaverRequest('/ncc/campaigns', 'GET', customerId, undefined, customKeys);

        if (!Array.isArray(campaigns) || campaigns.length === 0) {
          console.log(`[Background Sync] No campaigns found for customer ${customerId}`);
          activeSyncs.set(customerId, { status: 'success' });
          return;
        }

        allCampaignIds = campaigns.map(c => c.nccCampaignId);

        // Upsert Campaigns in batch
        const campaignRows = campaigns.map(camp => ({
          ncc_campaign_id: camp.nccCampaignId,
          customer_id: customerIdInt,
          name: camp.name,
          status: camp.status,
          type: camp.campaignTp
        }));
        await supabaseAdmin.from('campaigns').upsert(campaignRows);

        // 2. Fetch Ad Groups for all campaigns concurrently
        console.log(`[Background Sync] Fetching adgroups for ${campaigns.length} campaigns (concurrency = 3, delay = 50ms)...`);
        const adgroupsResults = await mapConcurrent(campaigns, 3, 50, async (camp) => {
          try {
            return await makeNaverRequest('/ncc/adgroups', 'GET', customerId, `nccCampaignId=${camp.nccCampaignId}`, customKeys);
          } catch (err) {
            console.error(`Failed to fetch adgroups for campaign ${camp.nccCampaignId}:`, err);
            return [];
          }
        });
        const adgroups = adgroupsResults.flat();
        allAdgroupIds = adgroups.map(a => a.nccAdgroupId);

        // Upsert Ad Groups in batch
        if (adgroups.length > 0) {
          const adgroupRows = adgroups.map(adg => ({
            ncc_adgroup_id: adg.nccAdgroupId,
            ncc_campaign_id: adg.nccCampaignId,
            customer_id: customerIdInt,
            name: adg.name,
            status: adg.status
          }));
          await supabaseAdmin.from('ad_groups').upsert(adgroupRows);
        }

        // 3. Fetch Ads and Keywords for all adgroups concurrently in parallel
        if (adgroups.length > 0) {
          console.log(`[Background Sync] Fetching ads and keywords for ${adgroups.length} adgroups in parallel (concurrency = 3, delay = 50ms)...`);
          
          const [adsResults, keywordsResults] = await Promise.all([
            mapConcurrent(adgroups, 3, 50, async (adg) => {
              try {
                return await makeNaverRequest('/ncc/ads', 'GET', customerId, `nccAdgroupId=${adg.nccAdgroupId}`, customKeys);
              } catch (err) {
                console.error(`Failed to fetch ads for adgroup ${adg.nccAdgroupId}:`, err);
                return [];
              }
            }),
            mapConcurrent(adgroups, 3, 50, async (adg) => {
              try {
                return await makeNaverRequest('/ncc/keywords', 'GET', customerId, `nccAdgroupId=${adg.nccAdgroupId}`, customKeys);
              } catch (err) {
                console.error(`Failed to fetch keywords for adgroup ${adg.nccAdgroupId}:`, err);
                return [];
              }
            })
          ]);

          ads = adsResults.flat();
          ads.forEach(ad => allAdIds.push(ad.nccAdId));

          keywords = keywordsResults.flat();
          keywords.forEach(kw => allKeywordIds.push(kw.nccKeywordId));

          // Batch Upsert Ads
          if (ads.length > 0) {
            const adRows = ads.map(adObj => {
              const parentAdg = adgroups.find(ag => ag.nccAdgroupId === adObj.nccAdgroupId);
              return {
                ncc_ad_id: adObj.nccAdId,
                ncc_adgroup_id: adObj.nccAdgroupId,
                ncc_campaign_id: parentAdg ? parentAdg.nccCampaignId : '',
                customer_id: customerIdInt,
                name: getAdName(adObj),
                type: adObj.type,
                image_url: getAdImageUrl(adObj),
                status: adObj.status
              };
            });
            await supabaseAdmin.from('ads').upsert(adRows);
          }

          // Batch Upsert Keywords
          if (keywords.length > 0) {
            const keywordRows = keywords.map(kw => {
              const parentAdg = adgroups.find(ag => ag.nccAdgroupId === kw.nccAdgroupId);
              return {
                ncc_keyword_id: kw.nccKeywordId,
                ncc_adgroup_id: kw.nccAdgroupId,
                ncc_campaign_id: parentAdg ? parentAdg.nccCampaignId : '',
                customer_id: customerIdInt,
                keyword: kw.keyword,
                status: kw.status
              };
            });
            await supabaseAdmin.from('keywords').upsert(keywordRows);
          }
        }
      }

      const hasShoppingCamps = campaigns.some((c: any) => c.campaignTp === 'SHOPPING' || c.type === 'SHOPPING');

      async function syncShoppingQueriesForDate(dateStr: string) {
        const customerIdStr = customerId as string;
        console.log(`[Background Sync] Requesting Shopping Query report for customer ${customerIdStr} on ${dateStr}...`);
        const statDt = dateStr.replace(/-/g, '');
        const reportTp = 'SHOPPINGKEYWORD_DETAIL';

        try {
          // 1. Post report job
          const body = { reportTp, statDt };
          const registerRes = await makeNaverRequest('/stat-reports', 'POST', customerIdStr, undefined, customKeys, body);
          const jobId = registerRes.reportJobId;
          
          if (!jobId) {
            console.log(`[Background Sync] No jobId returned for Shopping Query report on ${dateStr}`);
            return;
          }

          // 2. Poll report job status
          let reportJob = null;
          for (let i = 0; i < 15; i++) {
            await sleep(1000);
            reportJob = await makeNaverRequest(`/stat-reports/${jobId}`, 'GET', customerIdStr, undefined, customKeys);
            if (reportJob.status === 'BUILT' || reportJob.status === 'NONE' || reportJob.status === 'FAILED') {
              break;
            }
          }

          if (!reportJob || reportJob.status !== 'BUILT') {
            console.log(`[Background Sync] Shopping Query report did not build for ${dateStr}. Status: ${reportJob?.status}`);
            return;
          }

          console.log(`[Background Sync] Shopping Query report ready for ${dateStr}. Downloading...`);

          // 3. Download the report TSV
          const downloadUri = '/report-download';
          const downloadTimestamp = Date.now().toString();
          const secretKey = customKeys?.secretKey || process.env.NAVER_SECRET_KEY!;
          const apiKey = customKeys?.apiKey || process.env.NAVER_API_KEY!;
          const signature = generateSignature(downloadTimestamp, 'GET', downloadUri, secretKey);

          const downloadHeaders = {
            'X-Timestamp': downloadTimestamp,
            'X-API-KEY': apiKey,
            'X-Customer': customerIdStr,
            'X-Signature': signature
          };

          const downloadRes = await fetch(reportJob.downloadUrl, { headers: downloadHeaders });
          if (!downloadRes.ok) {
            console.error(`[Background Sync] Failed to download Shopping Query report: ${downloadRes.status}`);
            return;
          }

          const tsvText = await downloadRes.text();
          const lines = tsvText.split('\n').filter(l => l.trim() !== '');
          console.log(`[Background Sync] Downloaded ${lines.length} rows for Shopping Query report on ${dateStr}`);

          if (lines.length === 0) return;

          // 4. Load existing ads in DB for FK validation
          const { data: dbAds } = await supabaseAdmin
            .from('ads')
            .select('ncc_ad_id')
            .eq('customer_id', customerIdInt);
          const existingAdIds = new Set(dbAds?.map((a: any) => a.ncc_ad_id) || []);

          // 5. Parse and aggregate
          const queryMap = new Map();
          const statMap = new Map();

          for (const line of lines) {
            const cols = line.split('\t');
            if (cols.length < 15) continue;

            const rawDate = cols[0];
            if (rawDate.length !== 8) continue;
            const formattedDate = `${rawDate.substring(0, 4)}-${rawDate.substring(4, 6)}-${rawDate.substring(6, 8)}`;

            const campaignId = cols[2];
            const adgroupId = cols[3];
            const query = cols[4];
            const adId = cols[5];

            // Validate adId exists in DB to prevent foreign key errors
            if (!existingAdIds.has(adId)) {
              continue;
            }

            const imp = parseInt(cols[11], 10) || 0;
            const clk = parseInt(cols[12], 10) || 0;
            const cost = parseInt(cols[13], 10) || 0;

            const queryKey = `${adId}::${query}`;
            if (!queryMap.has(queryKey)) {
              queryMap.set(queryKey, {
                ncc_ad_id: adId,
                ncc_adgroup_id: adgroupId,
                ncc_campaign_id: campaignId,
                customer_id: customerIdInt,
                query: query
              });
            }

            const statKey = `${adId}::${query}::${formattedDate}`;
            if (!statMap.has(statKey)) {
              statMap.set(statKey, {
                ncc_ad_id: adId,
                query: query,
                stat_date: formattedDate,
                imp_cnt: 0,
                clk_cnt: 0,
                sales_amt: 0
              });
            }

            const stat = statMap.get(statKey);
            stat.imp_cnt += imp;
            stat.clk_cnt += clk;
            stat.sales_amt += cost;
          }

          // 6. Upsert Queries
          const queriesToUpsert = Array.from(queryMap.values());
          if (queriesToUpsert.length > 0) {
            console.log(`[Background Sync] Upserting ${queriesToUpsert.length} queries to shopping_ad_queries...`);
            const chunkSize = 200;
            for (let i = 0; i < queriesToUpsert.length; i += chunkSize) {
              const chunk = queriesToUpsert.slice(i, i + chunkSize);
              await supabaseAdmin.from('shopping_ad_queries').upsert(chunk, { onConflict: 'ncc_ad_id, query' });
            }
          }

          // 7. Upsert Stats
          const statsToUpsert = Array.from(statMap.values()).map(stat => {
            const ctr = stat.imp_cnt > 0 ? (stat.clk_cnt / stat.imp_cnt) * 100 : 0;
            const cpc = stat.clk_cnt > 0 ? Math.round(stat.sales_amt / stat.clk_cnt) : 0;
            return {
              ncc_ad_id: stat.ncc_ad_id,
              query: stat.query,
              stat_date: stat.stat_date,
              imp_cnt: stat.imp_cnt,
              clk_cnt: stat.clk_cnt,
              ctr: ctr,
              cpc: cpc,
              sales_amt: stat.sales_amt,
              purchase_ccnt: 0,
              purchase_conv_amt: 0,
              purchase_ror: 0,
              cp_conv: 0
            };
          });

          if (statsToUpsert.length > 0) {
            console.log(`[Background Sync] Upserting ${statsToUpsert.length} query stats to shopping_ad_query_stats...`);
            const chunkSize = 200;
            for (let i = 0; i < statsToUpsert.length; i += chunkSize) {
              const chunk = statsToUpsert.slice(i, i + chunkSize);
              await supabaseAdmin.from('shopping_ad_query_stats').upsert(chunk, { onConflict: 'ncc_ad_id, query, stat_date' });
            }
          }
        } catch (err) {
          console.error(`[Background Sync] Error syncing Shopping Queries for ${dateStr}:`, err);
        }
      }

      // 4. Fetch and upsert stats for target dates in parallel
      console.log(`[Background Sync] Fetching stats for ${datesToSync.length} dates in parallel...`);
      await Promise.all(datesToSync.map(async (dateStr) => {
        // Campaign stats
        if (allCampaignIds.length > 0) {
          const campStats = await fetchStatsInBatchesForDate(allCampaignIds, customerId, dateStr, 'campaign', customKeys);
          if (campStats.length > 0) {
            await supabaseAdmin.from('campaign_stats').upsert(campStats, { onConflict: 'ncc_campaign_id, stat_date' });
          }
        }

        // Ad Group stats
        if (allAdgroupIds.length > 0) {
          const adgStats = await fetchStatsInBatchesForDate(allAdgroupIds, customerId, dateStr, 'adgroup', customKeys);
          if (adgStats.length > 0) {
            await supabaseAdmin.from('ad_group_stats').upsert(adgStats, { onConflict: 'ncc_adgroup_id, stat_date' });
          }
        }

        // Ad stats
        if (allAdIds.length > 0) {
          const adStats = await fetchStatsInBatchesForDate(allAdIds, customerId, dateStr, 'ad', customKeys);
          if (adStats.length > 0) {
            await supabaseAdmin.from('ad_stats').upsert(adStats, { onConflict: 'ncc_ad_id, stat_date' });
          }
        }

        // Keyword stats
        if (allKeywordIds.length > 0) {
          const kwStats = await fetchStatsInBatchesForDate(allKeywordIds, customerId, dateStr, 'keyword', customKeys);
          if (kwStats.length > 0) {
            await supabaseAdmin.from('keyword_stats').upsert(kwStats, { onConflict: 'ncc_keyword_id, stat_date' });
          }
        }

        // Shopping Query stats
        if (hasShoppingCamps) {
          await syncShoppingQueriesForDate(dateStr);
        }
      }));

      // 5. Save synced dates to avoid duplicate fetches in the future
      const syncedDatesRows = datesToSync.map(d => ({
        customer_id: customerIdInt,
        synced_date: d
      }));
      await supabaseAdmin.from('synced_dates').upsert(syncedDatesRows, { onConflict: 'customer_id, synced_date' });

      // Fetch and update Bizmoney for this account
      try {
        console.log(`[Background Sync] Fetching bizmoney for customer ${customerId}`);
        const bizRes = await makeNaverRequest('/billing/bizmoney', 'GET', customerId, undefined, customKeys);
        if (bizRes && typeof bizRes.bizmoney === 'number') {
          await supabaseAdmin
            .from('ad_accounts')
            .update({ bizmoney: bizRes.bizmoney })
            .eq('customer_id', customerIdInt);
          console.log(`[Background Sync] Updated bizmoney for ${customerId} to ${bizRes.bizmoney}`);
        }
      } catch (err: any) {
        console.error(`[Background Sync] Failed to update bizmoney for customer ${customerId}:`, err.message);
      }

      console.log(`[Background Sync] Successfully completed for customer ${customerId}`);
      activeSyncs.set(customerId, { status: 'success' });
    } catch (err: any) {
      console.error(`[Background Sync] Error for customer ${customerId}:`, err);
      activeSyncs.set(customerId, { status: 'failed', error: err.message });
      throw err;
    }
  };

  if (syncMode === 'sync') {
    try {
      await runSyncAction();
      return NextResponse.json({ success: true, status: 'success' });
    } catch (err: any) {
      return NextResponse.json({ success: false, error: err.message || 'Sync failed' }, { status: 500 });
    }
  }

  // Fallback to background async execution
  runSyncAction().catch(e => console.error('[Sync API] Background sync failed:', e));
  return NextResponse.json({ success: true, message: 'Sync started in background', status: 'running' });
}
