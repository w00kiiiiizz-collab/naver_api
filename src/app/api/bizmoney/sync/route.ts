import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { makeNaverRequest } from '@/lib/naver';

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
  
  const workers = Array.from({ length: Math.min(limit, items.length) }, async (_, idx) => {
    if (delayMs > 0 && idx > 0) {
      await sleep(idx * Math.floor(delayMs / limit));
    }
    await worker();
  });
  
  await Promise.all(workers);
  return results;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const managerAccountNo = searchParams.get('managerAccountNo');

  try {
    let query = supabaseAdmin.from('ad_accounts').select('customer_id, ad_account_name, manager_account_no');
    if (managerAccountNo && managerAccountNo !== 'null' && managerAccountNo !== 'undefined' && managerAccountNo !== '') {
      query = query.eq('manager_account_no', parseInt(managerAccountNo, 10));
    }
    const { data: accounts, error: err } = await query;
    if (err || !accounts || accounts.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    console.log(`[Bizmoney Sync] Syncing bizmoney for ${accounts.length} accounts...`);

    // Fetch bizmoney for each account concurrently (limit: 5, delay: 60ms) to avoid rate limits
    const results = await mapConcurrent(accounts, 5, 60, async (acc) => {
      const custId = acc.customer_id.toString();
      try {
        // Find credentials matching the manager_account_no
        let customKeys: { apiKey: string; secretKey: string } | undefined;
        if (acc.manager_account_no) {
          const { data: profile } = await supabaseAdmin
            .from('user_profiles')
            .select('naver_api_key, naver_secret_key')
            .eq('manager_account_no', acc.manager_account_no)
            .maybeSingle();

          if (profile && profile.naver_api_key && profile.naver_secret_key) {
            customKeys = {
              apiKey: profile.naver_api_key,
              secretKey: profile.naver_secret_key
            };
          }
        }

        const res = await makeNaverRequest('/billing/bizmoney', 'GET', custId, undefined, customKeys);
        if (res && typeof res.bizmoney === 'number') {
          const val = res.bizmoney;
          await supabaseAdmin
            .from('ad_accounts')
            .update({ bizmoney: val })
            .eq('customer_id', acc.customer_id);
          return { customer_id: acc.customer_id, bizmoney: val, success: true };
        }
      } catch (e: any) {
        console.error(`[Bizmoney Sync] Failed for ${acc.ad_account_name} (${acc.customer_id}):`, e.message);
      }
      return { customer_id: acc.customer_id, bizmoney: null, success: false };
    });

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error(`[Bizmoney Sync] Error:`, error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
