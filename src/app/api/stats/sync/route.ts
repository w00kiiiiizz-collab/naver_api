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
  entityType: 'campaign' | 'adgroup' | 'ad' | 'keyword'
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
      const stats = await makeNaverRequest('/stats', 'GET', customerId, queryParams);
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get('customerId');
  const startDateStr = searchParams.get('startDate');
  const endDateStr = searchParams.get('endDate') || startDateStr;

  if (!customerId || !startDateStr) {
    return NextResponse.json({ success: false, error: 'Missing customerId or startDate' }, { status: 400 });
  }

  try {
    console.log(`On-demand sync for customer ${customerId} from ${startDateStr} to ${endDateStr}`);
    
    // Parse dates and bound them to avoid long loops (max 31 days)
    const start = parseISO(startDateStr);
    const end = parseISO(endDateStr!);
    const totalDays = differenceInDays(end, start);

    if (totalDays < 0) {
      return NextResponse.json({ success: false, error: 'startDate must be before or equal to endDate' }, { status: 400 });
    }
    if (totalDays > 31) {
      return NextResponse.json({ success: false, error: 'Cannot sync more than 31 days at once' }, { status: 400 });
    }

    // --- CHECK ALREADY SYNCED DATES ---
    const { data: alreadySynced } = await supabaseAdmin
      .from('synced_dates')
      .select('synced_date')
      .eq('customer_id', parseInt(customerId, 10))
      .gte('synced_date', startDateStr)
      .lte('synced_date', endDateStr);

    const syncedDateSet = new Set(alreadySynced?.map((d: any) => d.synced_date) || []);
    
    const datesToSync: string[] = [];
    for (let d = 0; d <= totalDays; d++) {
      const dateStr = format(addDays(start, d), 'yyyy-MM-dd');
      if (!syncedDateSet.has(dateStr)) {
        datesToSync.push(dateStr);
      }
    }

    if (datesToSync.length === 0) {
      console.log('All dates in range are already synced. Skipping Naver API calls.');
      return NextResponse.json({ success: true, message: `All dates between ${startDateStr} and ${endDateStr} are already synced.`, skipped: true });
    }

    console.log(`Need to sync dates: ${datesToSync.join(', ')}`);

    // 1. Fetch campaigns for this customer
    let campaigns: any[] = [];
    try {
      campaigns = await makeNaverRequest('/ncc/campaigns', 'GET', customerId);
    } catch (err: any) {
      return NextResponse.json({ success: false, error: 'Failed to fetch campaigns' }, { status: 500 });
    }

    if (!Array.isArray(campaigns) || campaigns.length === 0) {
      return NextResponse.json({ success: true, message: 'No campaigns found' });
    }

    const allCampaignIds: string[] = [];
    const allAdgroupIds: string[] = [];
    const allAdIds: string[] = [];
    const allKeywordIds: string[] = [];

    // 2. Fetch Hierarchy and save it
    for (const camp of campaigns) {
      await supabaseAdmin.from('campaigns').upsert({
        ncc_campaign_id: camp.nccCampaignId,
        customer_id: parseInt(customerId, 10),
        name: camp.name,
        status: camp.status
      });
      allCampaignIds.push(camp.nccCampaignId);

      // Fetch Ad Groups
      let adgroups: any[] = [];
      try {
        adgroups = await makeNaverRequest('/ncc/adgroups', 'GET', customerId, `nccCampaignId=${camp.nccCampaignId}`);
      } catch (err) {
        console.error(`Failed to fetch adgroups for campaign ${camp.nccCampaignId}`);
        continue;
      }

      if (!Array.isArray(adgroups)) continue;

      for (const adg of adgroups) {
        await supabaseAdmin.from('ad_groups').upsert({
          ncc_adgroup_id: adg.nccAdgroupId,
          ncc_campaign_id: camp.nccCampaignId,
          customer_id: parseInt(customerId, 10),
          name: adg.name,
          status: adg.status
        });
        allAdgroupIds.push(adg.nccAdgroupId);

        // Fetch Ads
        let ads: any[] = [];
        try {
          ads = await makeNaverRequest('/ncc/ads', 'GET', customerId, `nccAdgroupId=${adg.nccAdgroupId}`);
        } catch (err) {
          console.error(`Failed to fetch ads for adgroup ${adg.nccAdgroupId}`);
          continue;
        }

        if (!Array.isArray(ads)) continue;

        for (const adObj of ads) {
          await supabaseAdmin.from('ads').upsert({
            ncc_ad_id: adObj.nccAdId,
            ncc_adgroup_id: adg.nccAdgroupId,
            ncc_campaign_id: camp.nccCampaignId,
            customer_id: parseInt(customerId, 10),
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
              customer_id: parseInt(customerId, 10),
              keyword: kw.keyword,
              status: kw.status
            });
            allKeywordIds.push(kw.nccKeywordId);
          }
        }
      }
    }

    // 3. Fetch and upsert stats for target dates in batches
    for (const dateStr of datesToSync) {
      console.log(`Syncing stats for date: ${dateStr}...`);

      // Campaign stats
      const campStats = await fetchStatsInBatchesForDate(allCampaignIds, customerId, dateStr, 'campaign');
      if (campStats.length > 0) {
        await supabaseAdmin.from('campaign_stats').upsert(campStats, { onConflict: 'ncc_campaign_id, stat_date' });
      }

      // Ad Group stats
      const adgStats = await fetchStatsInBatchesForDate(allAdgroupIds, customerId, dateStr, 'adgroup');
      if (adgStats.length > 0) {
        await supabaseAdmin.from('ad_group_stats').upsert(adgStats, { onConflict: 'ncc_adgroup_id, stat_date' });
      }

      // Ad stats
      const adStats = await fetchStatsInBatchesForDate(allAdIds, customerId, dateStr, 'ad');
      if (adStats.length > 0) {
        await supabaseAdmin.from('ad_stats').upsert(adStats, { onConflict: 'ncc_ad_id, stat_date' });
      }

      // Keyword stats
      if (allKeywordIds.length > 0) {
        const kwStats = await fetchStatsInBatchesForDate(allKeywordIds, customerId, dateStr, 'keyword');
        if (kwStats.length > 0) {
          await supabaseAdmin.from('keyword_stats').upsert(kwStats, { onConflict: 'ncc_keyword_id, stat_date' });
        }
      }
    }

    // 4. Save synced dates to avoid duplicate fetches in the future
    const syncedDatesRows = datesToSync.map(d => ({
      customer_id: parseInt(customerId, 10),
      synced_date: d
    }));
    await supabaseAdmin.from('synced_dates').upsert(syncedDatesRows, { onConflict: 'customer_id, synced_date' });

    return NextResponse.json({ success: true, message: `Synced data for ${datesToSync.length} dates` });
  } catch (error: any) {
    console.error('On-demand Sync Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
