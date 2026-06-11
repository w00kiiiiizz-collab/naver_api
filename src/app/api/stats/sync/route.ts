import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { makeNaverRequest } from '@/lib/naver';
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
      let allCampaignIds: string[] = [];
      let allAdgroupIds: string[] = [];
      let allAdIds: string[] = [];
      let allKeywordIds: string[] = [];

      if (!runFullHierarchySync) {
        console.log(`[Background Sync] stats-only sync requested. Checking database for existing hierarchy...`);
        
        // Fetch campaigns from database
        const { data: dbCampaigns, error: campErr } = await supabaseAdmin
          .from('campaigns')
          .select('ncc_campaign_id, name, status')
          .eq('customer_id', customerIdInt);
        
        if (campErr || !dbCampaigns || dbCampaigns.length === 0) {
          console.log(`[Background Sync] No existing campaigns in database for customer ${customerId}. Falling back to full hierarchy sync.`);
          runFullHierarchySync = true;
        } else {
          campaigns = dbCampaigns.map(c => ({
            nccCampaignId: c.ncc_campaign_id,
            name: c.name,
            status: c.status
          }));
          allCampaignIds = campaigns.map(c => c.nccCampaignId);

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
          status: camp.status
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
      }));

      // 5. Save synced dates to avoid duplicate fetches in the future
      const syncedDatesRows = datesToSync.map(d => ({
        customer_id: customerIdInt,
        synced_date: d
      }));
      await supabaseAdmin.from('synced_dates').upsert(syncedDatesRows, { onConflict: 'customer_id, synced_date' });

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
