'use client';

import { useEffect, useState, useMemo, Fragment } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';
import { 
  BarChart3, 
  Users, 
  DollarSign, 
  MousePointerClick, 
  Activity, 
  Search, 
  RefreshCw, 
  Calendar,
  ChevronDown,
  ChevronRight,
  Folder,
  Tag,
  Megaphone,
  AlertCircle,
  Sun,
  Moon,
  ChevronsUpDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Settings,
  LogOut
} from 'lucide-react';
import { format, subDays, parseISO, subMonths, startOfMonth, endOfMonth, addDays, differenceInDays } from 'date-fns';

const metricLabelMap: Record<string, string> = {
  imp_cnt: '노출수',
  clk_cnt: '클릭수',
  ctr: '클릭률',
  cpc: '평균CPC',
  sales_amt: '총비용',
  purchase_ccnt: '전환수',
  purchase_conv_amt: '전환매출액',
  purchase_ror: 'ROAS',
  cp_conv: '전환당비용'
};

const metricColorMap: Record<string, { hex: string, bg: string, border: string, text: string }> = {
  imp_cnt: { hex: '#3b82f6', bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400' },
  clk_cnt: { hex: '#10b981', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400' },
  ctr: { hex: '#06b6d4', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', text: 'text-cyan-400' },
  cpc: { hex: '#f59e0b', bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400' },
  sales_amt: { hex: '#f43f5e', bg: 'bg-rose-500/10', border: 'border-rose-500/30', text: 'text-rose-400' },
  purchase_ccnt: { hex: '#f97316', bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400' },
  purchase_conv_amt: { hex: '#8b5cf6', bg: 'bg-violet-500/10', border: 'border-violet-500/30', text: 'text-violet-400' },
  purchase_ror: { hex: '#ec4899', bg: 'bg-pink-500/10', border: 'border-pink-500/30', text: 'text-pink-400' },
  cp_conv: { hex: '#6366f1', bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', text: 'text-indigo-400' }
};

const getMetricIcon = (m: string) => {
  switch (m) {
    case 'imp_cnt': return <Activity size={15} className="text-blue-500" />;
    case 'clk_cnt': return <MousePointerClick size={15} className="text-emerald-500" />;
    case 'ctr': return <Activity size={15} className="text-cyan-500" />;
    case 'cpc': return <DollarSign size={15} className="text-amber-500" />;
    case 'sales_amt': return <DollarSign size={15} className="text-rose-500" />;
    case 'purchase_ccnt': return <Users size={15} className="text-orange-500" />;
    case 'purchase_conv_amt': return <BarChart3 size={15} className="text-indigo-500" />;
    case 'purchase_ror': return <BarChart3 size={15} className="text-pink-500" />;
    case 'cp_conv': return <DollarSign size={15} className="text-indigo-500" />;
    default: return <Activity size={15} className="text-blue-500" />;
  }
};

const formatMetricValue = (key: string, value: number) => {
  if (key === 'ctr' || key === 'purchase_ror') {
    return `${value.toFixed(2)}%`;
  }
  if (key === 'cpc' || key === 'sales_amt' || key === 'purchase_conv_amt' || key === 'cp_conv') {
    return `${Math.round(value).toLocaleString()}원`;
  }
  return Math.round(value).toLocaleString();
};

const managerFallbackMap: Record<number | string, string> = {
  44851: '이정민',
  44865: '이수정',
  41264: '홍수정',
  38270: '박상민',
  38271: '김용덕',
  29271: '최혜림',
  29621: '엄도윤',
  27205: '김상욱',
  27195: '9팀',
  2769: '김상욱'
};

export default function Home() {
  const router = useRouter();
  const [userProfile, setUserProfile] = useState<any | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // User profiles list for admin management
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [profilesList, setProfilesList] = useState<any[]>([]);

  // Local state for editing current user's own Naver API keys in modal
  const [ownApiKey, setOwnApiKey] = useState('');
  const [ownSecretKey, setOwnSecretKey] = useState('');
  const [ownCustomerId, setOwnCustomerId] = useState('');
  const [savingOwnKeys, setSavingOwnKeys] = useState(false);
  const [selectedManagerFilter, setSelectedManagerFilter] = useState<string>('all');

  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<any | null>(null);
  
  // View states & overall aggregates
  const [activeView, setActiveView] = useState<'overview' | 'detail'>('overview');
  const [allCampaignsList, setAllCampaignsList] = useState<any[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [syncingBizmoney, setSyncingBizmoney] = useState(false);
  
  // Raw data from database
  const [rawCampaigns, setRawCampaigns] = useState<any[]>([]);
  const [rawAdgroups, setRawAdgroups] = useState<any[]>([]);
  const [rawAds, setRawAds] = useState<any[]>([]);
  const [rawKeywords, setRawKeywords] = useState<any[]>([]);
  const [rawShoppingQueries, setRawShoppingQueries] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dbError, setDbError] = useState<string | null>(null);
  const [syncTime, setSyncTime] = useState<number>(0);
  const [syncMessage, setSyncMessage] = useState<string>('');
  const [syncHierarchy, setSyncHierarchy] = useState<boolean>(false);
  
  // Custom theme selector ('dark' | 'light')
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  // Selected date preset code
  const [selectedPreset, setSelectedPreset] = useState<string>('yesterday');
  
  // Date Range Selection (Default to yesterday)
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 1), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(subDays(new Date(), 1), 'yyyy-MM-dd'));

  // Table expansion state
  const [expandedCampaigns, setExpandedCampaigns] = useState<Record<string, boolean>>({});
  const [expandedAdgroups, setExpandedAdgroups] = useState<Record<string, boolean>>({});
  const [expandedAds, setExpandedAds] = useState<Record<string, boolean>>({});

  // Tree Table Sorting State
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Overview Table Sorting State (Default to sales_amt / desc)
  const [overviewSortField, setOverviewSortField] = useState<string | null>('sales_amt');
  const [overviewSortOrder, setOverviewSortOrder] = useState<'asc' | 'desc'>('desc');

  // Summary Card selected metrics
  const [card1Metric, setCard1Metric] = useState<string>('imp_cnt');
  const [card2Metric, setCard2Metric] = useState<string>('clk_cnt');
  const [card3Metric, setCard3Metric] = useState<string>('sales_amt');
  const [card4Metric, setCard4Metric] = useState<string>('purchase_conv_amt');

  // Chart Plotted Multiple Metrics State
  const [selectedChartMetrics, setSelectedChartMetrics] = useState<string[]>(['sales_amt']);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // 0. Authentication and Profile loading
  useEffect(() => {
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }

      // Fetch user profile
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
      
      setUserProfile(profile || { id: session.user.id, email: session.user.email, role: 'manager' });
      setCheckingAuth(false);
    }
    checkAuth();
  }, [router]);

  // 1. Load accounts
  useEffect(() => {
    async function loadAccounts() {
      if (!userProfile) return;
      
      let query = supabase.from('ad_accounts').select('*');
      
      // If user is a manager, only query their assigned accounts
      if (userProfile.role === 'manager' && userProfile.manager_account_no) {
        query = query.eq('manager_account_no', userProfile.manager_account_no);
      }
      
      const { data, error } = await query.order('ad_account_name');
      if (data) {
        setAccounts(data);
        if (data.length > 0) {
          setSelectedAccount(data[0]);
        } else {
          setSelectedAccount(null);
        }
      } else {
        setAccounts([]);
        setSelectedAccount(null);
      }
      setLoading(false);
    }
    loadAccounts();
  }, [userProfile]);

  // Filter accounts by search query and manager filter
  const filteredAccounts = useMemo(() => {
    return accounts.filter(acc => {
      const matchesSearch = acc.ad_account_name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesManager = selectedManagerFilter === 'all' 
        ? true 
        : acc.manager_account_no?.toString() === selectedManagerFilter;
      return matchesSearch && matchesManager;
    });
  }, [accounts, searchQuery, selectedManagerFilter]);

  // Dynamically extract unique managers from accounts list AND active user profiles list
  const dynamicManagers = useMemo(() => {
    const map: Record<number | string, string> = {};
    
    // 1. Extract from loaded accounts (contains manager name from Naver API)
    accounts.forEach(acc => {
      if (acc.manager_account_no) {
        map[acc.manager_account_no] = acc.manager_name || managerFallbackMap[acc.manager_account_no] || `매니저 ${acc.manager_account_no}`;
      }
    });

    // 2. Extract from active profiles (contains manager ID for users who registered but have no stats yet)
    profilesList.forEach(p => {
      if (p.manager_account_no) {
        const emailPrefix = p.email.split('@')[0];
        if (!map[p.manager_account_no]) {
          map[p.manager_account_no] = `${emailPrefix} (신규가입)`;
        }
      }
    });

    // 3. Fill in default mapping fallback rules
    Object.entries(managerFallbackMap).forEach(([no, name]) => {
      if (!map[no]) {
        map[no] = name;
      }
    });
    return map;
  }, [accounts, profilesList]);

  // 2. Load overview stats for all accounts
  async function loadOverviewData() {
    if (accounts.length === 0) return;
    setLoadingOverview(true);
    setDbError(null);
    
    const allowedCustomerIds = accounts.map(a => a.customer_id);
    
    const { data: camps, error: campErr } = await supabase
      .from('campaigns')
      .select(`
        customer_id, ncc_campaign_id, name, status, type,
        campaign_stats (
          stat_date, imp_cnt, clk_cnt, ctr, cpc, sales_amt, purchase_ccnt, purchase_conv_amt, purchase_ror, cp_conv
        )
      `)
      .in('customer_id', allowedCustomerIds)
      .gte('campaign_stats.stat_date', startDate)
      .lte('campaign_stats.stat_date', endDate);

    if (campErr && campErr.message.includes("Could not find the table")) {
      setDbError("Supabase 데이터베이스에 Campaigns 테이블이 구성되지 않았습니다.");
    }

    setAllCampaignsList(camps || []);
    setLoadingOverview(false);
  }

  // 2.5. Load detailed data for selected account
  async function loadDetailData() {
    if (!selectedAccount) return;
    setLoading(true);
    setDbError(null);
    
    // Fetch Campaigns
    const { data: camps, error: campErr } = await supabase
      .from('campaigns')
      .select(`
        ncc_campaign_id, name, status, type,
        campaign_stats (
          stat_date, imp_cnt, clk_cnt, ctr, cpc, sales_amt, purchase_ccnt, purchase_conv_amt, purchase_ror, cp_conv
        )
      `)
      .eq('customer_id', selectedAccount.customer_id)
      .gte('campaign_stats.stat_date', startDate)
      .lte('campaign_stats.stat_date', endDate)
      .order('name');

    // Fetch Ad Groups
    const { data: adgs, error: adgErr } = await supabase
      .from('ad_groups')
      .select(`
        ncc_adgroup_id, ncc_campaign_id, name, status,
        ad_group_stats (
          stat_date, imp_cnt, clk_cnt, ctr, cpc, sales_amt, purchase_ccnt, purchase_conv_amt, purchase_ror, cp_conv
        )
      `)
      .eq('customer_id', selectedAccount.customer_id)
      .gte('ad_group_stats.stat_date', startDate)
      .lte('ad_group_stats.stat_date', endDate)
      .order('name');

    // Fetch Ads (Creatives)
    const { data: adsList, error: adsErr } = await supabase
      .from('ads')
      .select(`
        ncc_ad_id, ncc_adgroup_id, ncc_campaign_id, name, type, image_url, status,
        ad_stats (
          stat_date, imp_cnt, clk_cnt, ctr, cpc, sales_amt, purchase_ccnt, purchase_conv_amt, purchase_ror, cp_conv
        )
      `)
      .eq('customer_id', selectedAccount.customer_id)
      .gte('ad_stats.stat_date', startDate)
      .lte('ad_stats.stat_date', endDate)
      .order('name');

    // Fetch Keywords
    const { data: keywordsList, error: kwErr } = await supabase
      .from('keywords')
      .select(`
        ncc_keyword_id, ncc_adgroup_id, ncc_campaign_id, keyword, status,
        keyword_stats (
          stat_date, imp_cnt, clk_cnt, ctr, cpc, sales_amt, purchase_ccnt, purchase_conv_amt, purchase_ror, cp_conv
        )
      `)
      .eq('customer_id', selectedAccount.customer_id)
      .gte('keyword_stats.stat_date', startDate)
      .lte('keyword_stats.stat_date', endDate)
      .order('keyword');

    // Fetch Shopping Search Queries
    const { data: shoppingQueriesList, error: sqErr } = await supabase
      .from('shopping_ad_queries')
      .select(`
        ncc_ad_id, query,
        shopping_ad_query_stats (
          stat_date, imp_cnt, clk_cnt, ctr, cpc, sales_amt, purchase_ccnt, purchase_conv_amt, purchase_ror, cp_conv
        )
      `)
      .eq('customer_id', selectedAccount.customer_id)
      .gte('shopping_ad_query_stats.stat_date', startDate)
      .lte('shopping_ad_query_stats.stat_date', endDate);

    // Check if tables are missing in the schema
    let schemaMissing = false;
    if (campErr && campErr.message.includes("Could not find the table")) schemaMissing = true;
    if (adgErr && adgErr.message.includes("Could not find the table")) schemaMissing = true;
    if (adsErr && adsErr.message.includes("Could not find the table")) schemaMissing = true;
    if (kwErr && kwErr.message.includes("Could not find the table")) schemaMissing = true;
    if (sqErr && sqErr.message.includes("Could not find the table")) schemaMissing = true;

    if (schemaMissing) {
      setDbError("Supabase 데이터베이스에 광고그룹(`ad_groups`), 소재(`ads`), 키워드(`keywords`), 쇼핑검색어(`shopping_ad_queries`) 테이블이 구성되지 않았습니다. 동기화를 시작하기 전에 supabase_schema.sql 스크립트를 Supabase SQL Editor에서 실행하고 'NOTIFY pgrst, 'reload schema';' 명령어로 스키마 캐시를 갱신해 주세요.");
    }

    setRawCampaigns(camps || []);
    setRawAdgroups(adgs || []);
    setRawAds(adsList || []);
    setRawKeywords(keywordsList || []);
    setRawShoppingQueries(shoppingQueriesList || []);
    setLoading(false);
  }

  // Live Bizmoney Sync
  const syncAllBizmoney = async () => {
    if (!userProfile || accounts.length === 0) return;
    setSyncingBizmoney(true);
    try {
      const managerNo = userProfile.role === 'manager' 
        ? userProfile.manager_account_no 
        : (selectedManagerFilter !== 'all' ? selectedManagerFilter : '');
      const response = await fetch(`/api/bizmoney/sync?managerAccountNo=${managerNo || ''}`);
      const resData = await response.json();
      if (resData.success) {
        // Refresh ad_accounts from DB to load updated bizmoney values
        let query = supabase.from('ad_accounts').select('*');
        if (userProfile.role === 'manager' && userProfile.manager_account_no) {
          query = query.eq('manager_account_no', userProfile.manager_account_no);
        } else if (userProfile.role === 'admin' && selectedManagerFilter !== 'all') {
          query = query.eq('manager_account_no', parseInt(selectedManagerFilter, 10));
        }
        const { data } = await query.order('ad_account_name');
        if (data) {
          setAccounts(prev => {
            const accMap = new Map(data.map(a => [a.customer_id, a]));
            return prev.map(oldAcc => accMap.get(oldAcc.customer_id) || oldAcc);
          });
        }
      }
    } catch (e) {
      console.error('Failed to sync bizmoney:', e);
    } finally {
      setSyncingBizmoney(false);
    }
  };

  // 2.6. Load Overview Data when accounts or dates change
  useEffect(() => {
    if (accounts.length > 0) {
      loadOverviewData();
    }
  }, [accounts, startDate, endDate]);

  // 2.7. Load Detail Data when viewing detail
  useEffect(() => {
    if (activeView === 'detail' && selectedAccount) {
      loadDetailData();
    }
  }, [activeView, selectedAccount, startDate, endDate]);

  // Removed auto-sync bizmoney on first load to prevent 880-account loading freezes

  // Expand campaigns by default once data is loaded to make it easy for user
  useEffect(() => {
    if (rawCampaigns.length > 0) {
      const exp: Record<string, boolean> = {};
      rawCampaigns.forEach(c => {
        exp[c.ncc_campaign_id] = true;
      });
      setExpandedCampaigns(exp);
    }
  }, [rawCampaigns]);

  useEffect(() => {
    if (rawAdgroups.length > 0) {
      const exp: Record<string, boolean> = {};
      rawAdgroups.forEach(ag => {
        exp[ag.ncc_adgroup_id] = true;
      });
      setExpandedAdgroups(exp);
    }
  }, [rawAdgroups]);

  // Expand / Collapse all fields controls
  const handleExpandAll = () => {
    const nextCampaigns: Record<string, boolean> = {};
    const nextAdgroups: Record<string, boolean> = {};
    const nextAds: Record<string, boolean> = {};
    
    rawCampaigns.forEach(c => {
      nextCampaigns[c.ncc_campaign_id] = true;
    });
    rawAdgroups.forEach(ag => {
      nextAdgroups[ag.ncc_adgroup_id] = true;
    });
    rawAds.forEach(ad => {
      nextAds[ad.ncc_ad_id] = true;
    });
    
    setExpandedCampaigns(nextCampaigns);
    setExpandedAdgroups(nextAdgroups);
    setExpandedAds(nextAds);
  };

  const handleCollapseAll = () => {
    setExpandedCampaigns({});
    setExpandedAdgroups({});
    setExpandedAds({});
  };

  const toggleAd = (id: string) => {
    setExpandedAds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // 3. Client-side Statistics Aggregator
  const aggregateStats = (statsList: any[]) => {
    const aggregated = statsList.reduce((acc, curr) => {
      const statDate = curr.stat_date;
      if (statDate >= startDate && statDate <= endDate) {
        acc.imp_cnt += (curr.imp_cnt || 0);
        acc.clk_cnt += (curr.clk_cnt || 0);
        acc.sales_amt += (curr.sales_amt || 0);
        acc.purchase_ccnt += (curr.purchase_ccnt || 0);
        acc.purchase_conv_amt += (curr.purchase_conv_amt || 0);
      }
      return acc;
    }, { imp_cnt: 0, clk_cnt: 0, sales_amt: 0, purchase_ccnt: 0, purchase_conv_amt: 0 });

    const ctr = aggregated.imp_cnt > 0 ? (aggregated.clk_cnt / aggregated.imp_cnt) * 100 : 0;
    const cpc = aggregated.clk_cnt > 0 ? Math.round(aggregated.sales_amt / aggregated.clk_cnt) : 0;
    const purchase_ror = aggregated.sales_amt > 0 ? (aggregated.purchase_conv_amt / aggregated.sales_amt) * 100 : 0;
    const cp_conv = aggregated.purchase_ccnt > 0 ? Math.round(aggregated.sales_amt / aggregated.purchase_ccnt) : 0;

    return {
      ...aggregated,
      ctr,
      cpc,
      purchase_ror,
      cp_conv
    };
  };

  // Compile final hierarchy with aggregated data
  const campaignsData = useMemo(() => {
    return rawCampaigns.map(camp => ({
      ...camp,
      ...aggregateStats(camp.campaign_stats || [])
    }));
  }, [rawCampaigns, startDate, endDate]);

  const adgroupsData = useMemo(() => {
    return rawAdgroups.map(adg => ({
      ...adg,
      ...aggregateStats(adg.ad_group_stats || [])
    }));
  }, [rawAdgroups, startDate, endDate]);

  const adsData = useMemo(() => {
    return rawAds.map(ad => ({
      ...ad,
      ...aggregateStats(ad.ad_stats || [])
    }));
  }, [rawAds, startDate, endDate]);

  const keywordsData = useMemo(() => {
    return rawKeywords.map(kw => ({
      ...kw,
      name: kw.keyword,
      isKeyword: true,
      ...aggregateStats(kw.keyword_stats || [])
    }));
  }, [rawKeywords, startDate, endDate]);

  const shoppingQueriesData = useMemo(() => {
    return rawShoppingQueries.map(sq => ({
      ...sq,
      name: sq.query,
      isQuery: true,
      ...aggregateStats(sq.shopping_ad_query_stats || [])
    }));
  }, [rawShoppingQueries, startDate, endDate]);

  // 4. Sorting logic at each nested level
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const getSortedData = (dataArray: any[]) => {
    if (!sortField) return dataArray;
    return [...dataArray].sort((a, b) => {
      const valA = a[sortField] || 0;
      const valB = b[sortField] || 0;
      return sortOrder === 'asc' ? valA - valB : valB - valA;
    });
  };

  const sortedCampaigns = useMemo(() => getSortedData(campaignsData), [campaignsData, sortField, sortOrder]);
  const sortedAdgroups = useMemo(() => getSortedData(adgroupsData), [adgroupsData, sortField, sortOrder]);
  const sortedAds = useMemo(() => getSortedData(adsData), [adsData, sortField, sortOrder]);
  const sortedKeywords = useMemo(() => getSortedData(keywordsData), [keywordsData, sortField, sortOrder]);
  const sortedShoppingQueries = useMemo(() => getSortedData(shoppingQueriesData), [shoppingQueriesData, sortField, sortOrder]);

  // Aggregate stats by customer_id for filtered accounts
  const allAccountsStats = useMemo(() => {
    const statsMap: Record<number | string, {
      imp_cnt: number;
      clk_cnt: number;
      sales_amt: number;
      purchase_ccnt: number;
      purchase_conv_amt: number;
      ctr: number;
      cpc: number;
      purchase_ror: number;
      cp_conv: number;
    }> = {};

    // Initialize with empty stats
    filteredAccounts.forEach(acc => {
      statsMap[acc.customer_id] = {
        imp_cnt: 0,
        clk_cnt: 0,
        sales_amt: 0,
        purchase_ccnt: 0,
        purchase_conv_amt: 0,
        ctr: 0,
        cpc: 0,
        purchase_ror: 0,
        cp_conv: 0
      };
    });

    // Sum from campaigns
    allCampaignsList.forEach(camp => {
      const custId = camp.customer_id;
      if (!statsMap[custId]) return;

      (camp.campaign_stats || []).forEach((stat: any) => {
        if (stat.stat_date >= startDate && stat.stat_date <= endDate) {
          statsMap[custId].imp_cnt += (stat.imp_cnt || 0);
          statsMap[custId].clk_cnt += (stat.clk_cnt || 0);
          statsMap[custId].sales_amt += (stat.sales_amt || 0);
          statsMap[custId].purchase_ccnt += (stat.purchase_ccnt || 0);
          statsMap[custId].purchase_conv_amt += (stat.purchase_conv_amt || 0);
        }
      });
    });

    // Compute derived rates
    filteredAccounts.forEach(acc => {
      const s = statsMap[acc.customer_id];
      if (s) {
        s.ctr = s.imp_cnt > 0 ? (s.clk_cnt / s.imp_cnt) * 100 : 0;
        s.cpc = s.clk_cnt > 0 ? Math.round(s.sales_amt / s.clk_cnt) : 0;
        s.purchase_ror = s.sales_amt > 0 ? (s.purchase_conv_amt / s.sales_amt) * 100 : 0;
        s.cp_conv = s.purchase_ccnt > 0 ? Math.round(s.sales_amt / s.purchase_ccnt) : 0;
      }
    });

    return statsMap;
  }, [filteredAccounts, allCampaignsList, startDate, endDate]);

  // Handle Overview Sorting
  const handleOverviewSort = (field: string) => {
    if (overviewSortField === field) {
      setOverviewSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setOverviewSortField(field);
      setOverviewSortOrder('desc'); // Default to descending order on first click
    }
  };

  const sortedOverviewAccounts = useMemo(() => {
    if (!overviewSortField) return filteredAccounts;

    return [...filteredAccounts].sort((a, b) => {
      let valA: any = 0;
      let valB: any = 0;

      if (overviewSortField === 'ad_account_name') {
        valA = a.ad_account_name;
        valB = b.ad_account_name;
        
        if (overviewSortOrder === 'asc') {
          return valA.localeCompare(valB, 'ko');
        } else {
          return valB.localeCompare(valA, 'ko');
        }
      } else if (overviewSortField === 'bizmoney') {
        valA = a.bizmoney || 0;
        valB = b.bizmoney || 0;
      } else {
        const statsA = allAccountsStats[a.customer_id];
        const statsB = allAccountsStats[b.customer_id];
        valA = statsA ? (statsA[overviewSortField as keyof typeof statsA] || 0) : 0;
        valB = statsB ? (statsB[overviewSortField as keyof typeof statsB] || 0) : 0;
      }

      if (valA < valB) return overviewSortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return overviewSortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredAccounts, overviewSortField, overviewSortOrder, allAccountsStats]);

  // Overall combined totals across filtered accounts
  const overallSummary = useMemo(() => {
    const totals = {
      imp_cnt: 0,
      clk_cnt: 0,
      sales_amt: 0,
      purchase_ccnt: 0,
      purchase_conv_amt: 0
    };

    filteredAccounts.forEach(acc => {
      const s = allAccountsStats[acc.customer_id];
      if (s) {
        totals.imp_cnt += s.imp_cnt;
        totals.clk_cnt += s.clk_cnt;
        totals.sales_amt += s.sales_amt;
        totals.purchase_ccnt += s.purchase_ccnt;
        totals.purchase_conv_amt += s.purchase_conv_amt;
      }
    });

    const ctr = totals.imp_cnt > 0 ? (totals.clk_cnt / totals.imp_cnt) * 100 : 0;
    const cpc = totals.clk_cnt > 0 ? Math.round(totals.sales_amt / totals.clk_cnt) : 0;
    const purchase_ror = totals.sales_amt > 0 ? (totals.purchase_conv_amt / totals.sales_amt) * 100 : 0;
    const cp_conv = totals.purchase_ccnt > 0 ? Math.round(totals.sales_amt / totals.purchase_ccnt) : 0;

    return {
      ...totals,
      ctr,
      cpc,
      purchase_ror,
      cp_conv
    };
  }, [allAccountsStats, filteredAccounts]);

  // Overall account summary (summed from top-level campaigns)
  const summary = useMemo(() => {
    const totals = campaignsData.reduce((acc, curr) => ({
      imp_cnt: acc.imp_cnt + (curr.imp_cnt || 0),
      clk_cnt: acc.clk_cnt + (curr.clk_cnt || 0),
      sales_amt: acc.sales_amt + (curr.sales_amt || 0),
      purchase_ccnt: acc.purchase_ccnt + (curr.purchase_ccnt || 0),
      purchase_conv_amt: acc.purchase_conv_amt + (curr.purchase_conv_amt || 0)
    }), { imp_cnt: 0, clk_cnt: 0, sales_amt: 0, purchase_ccnt: 0, purchase_conv_amt: 0 });

    const ctr = totals.imp_cnt > 0 ? (totals.clk_cnt / totals.imp_cnt) * 100 : 0;
    const cpc = totals.clk_cnt > 0 ? Math.round(totals.sales_amt / totals.clk_cnt) : 0;
    const purchase_ror = totals.sales_amt > 0 ? (totals.purchase_conv_amt / totals.sales_amt) * 100 : 0;
    const cp_conv = totals.purchase_ccnt > 0 ? Math.round(totals.sales_amt / totals.purchase_ccnt) : 0;

    return {
      ...totals,
      ctr,
      cpc,
      purchase_ror,
      cp_conv
    };
  }, [campaignsData]);

  // 5. Daily Trend Graph Data Aggregation
  const dailyChartData = useMemo(() => {
    const dateMap: Record<string, any> = {};
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    const totalDays = differenceInDays(end, start);
    
    // Seed all dates with empty statistics
    for (let d = 0; d <= totalDays; d++) {
      const dateStr = format(addDays(start, d), 'yyyy-MM-dd');
      dateMap[dateStr] = {
        dateStr,
        dateLabel: format(addDays(start, d), 'MM-dd'),
        imp_cnt: 0,
        clk_cnt: 0,
        sales_amt: 0,
        purchase_ccnt: 0,
        purchase_conv_amt: 0
      };
    }

    // Accumulate campaign stats
    rawCampaigns.forEach(camp => {
      (camp.campaign_stats || []).forEach((stat: any) => {
        const dateStr = stat.stat_date;
        if (dateMap[dateStr]) {
          dateMap[dateStr].imp_cnt += (stat.imp_cnt || 0);
          dateMap[dateStr].clk_cnt += (stat.clk_cnt || 0);
          dateMap[dateStr].sales_amt += (stat.sales_amt || 0);
          dateMap[dateStr].purchase_ccnt += (stat.purchase_ccnt || 0);
          dateMap[dateStr].purchase_conv_amt += (stat.purchase_conv_amt || 0);
        }
      });
    });

    // Form final arrays and compute ratios
    return Object.values(dateMap)
      .sort((a: any, b: any) => a.dateStr.localeCompare(b.dateStr))
      .map((item: any) => {
        const ctr = item.imp_cnt > 0 ? (item.clk_cnt / item.imp_cnt) * 100 : 0;
        const cpc = item.clk_cnt > 0 ? Math.round(item.sales_amt / item.clk_cnt) : 0;
        const purchase_ror = item.sales_amt > 0 ? (item.purchase_conv_amt / item.sales_amt) * 100 : 0;
        const cp_conv = item.purchase_ccnt > 0 ? Math.round(item.sales_amt / item.purchase_ccnt) : 0;
        
        return {
          ...item,
          ctr,
          cpc,
          purchase_ror,
          cp_conv
        };
      });
  }, [rawCampaigns, startDate, endDate]);

  // 6. SVG Drawing calculations
  const svgWidth = 1000;
  const svgHeight = 180;
  const paddingLeft = 50;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 25;
  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = svgHeight - paddingTop - paddingBottom;

  const multipleChartLines = useMemo(() => {
    if (dailyChartData.length === 0) return [];

    return selectedChartMetrics.map(metric => {
      // Find min and max of target metric
      const values = dailyChartData.map((d: any) => d[metric] || 0);
      const maxY = Math.max(...values, 1);
      const minY = 0;

      const points = dailyChartData.map((item: any, idx) => {
        const val = item[metric] || 0;
        const x = paddingLeft + (idx / Math.max(dailyChartData.length - 1, 1)) * plotWidth;
        const y = paddingTop + plotHeight - ((val - minY) / (maxY - minY)) * plotHeight;
        return { x, y, value: val, date: item.dateStr, label: item.dateLabel };
      });

      // Create path D
      const pathD = points.reduce((acc, p, idx) => {
        return acc + (idx === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`);
      }, '');

      // Create area D
      const first = points[0];
      const last = points[points.length - 1];
      const floorY = paddingTop + plotHeight;
      const areaD = `${pathD} L ${last.x} ${floorY} L ${first.x} ${floorY} Z`;

      return {
        metric,
        points,
        pathD,
        areaD,
        color: metricColorMap[metric]?.hex || '#3b82f6'
      };
    });
  }, [dailyChartData, selectedChartMetrics]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (multipleChartLines.length === 0 || multipleChartLines[0].points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * svgWidth;
    
    // Find closest point
    let closestIdx = 0;
    let minDiff = Infinity;
    multipleChartLines[0].points.forEach((p, idx) => {
      const diff = Math.abs(p.x - mouseX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });

    setHoveredIndex(closestIdx);
    
    // Position tooltip relative to HTML viewport
    const pt = multipleChartLines[0].points[closestIdx];
    const tooltipX = rect.left + (pt.x / svgWidth) * rect.width;
    const tooltipY = rect.top + (pt.y / svgHeight) * rect.height - 55;
    setTooltipPos({ x: tooltipX, y: tooltipY });
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
  };

  // 7. On-Demand Sync for Date Range (Synchronous)
  async function handleSync() {
    if (!selectedAccount) return;
    setSyncing(true);
    setSyncTime(0);
    setSyncMessage('네이버 API 데이터 동기화 진행 중...');

    // Timer to track elapsed time
    const timerInterval = setInterval(() => {
      setSyncTime(prev => prev + 1);
    }, 1000);

    try {
      // 1. Run sync synchronously and wait for completion
      const res = await fetch(`/api/stats/sync?customerId=${selectedAccount.customer_id}&startDate=${startDate}&endDate=${endDate}&force=true&syncHierarchy=${syncHierarchy}&syncMode=sync`);
      const result = await res.json();
      
      clearInterval(timerInterval);
      setSyncMessage('');

      if (!result.success) {
        alert('동기화 실패: ' + (result.error || '알 수 없는 오류가 발생했습니다.'));
        setSyncing(false);
        return;
      }

      setSyncing(false);
      await loadDetailData();
      await loadOverviewData();
      alert('동기화가 성공적으로 완료되었습니다!');
    } catch (err) {
      clearInterval(timerInterval);
      setSyncMessage('');
      alert('동기화 과정에서 오류가 발생했습니다.');
      setSyncing(false);
    }
  }

  // CSV/Excel Download Helper Function
  const downloadCSV = (filename: string, headers: string[], rows: any[][]) => {
    const BOM = '\uFEFF';
    const csvContent = [
      headers.join(','),
      ...rows.map(row => 
        row.map(val => {
          let strVal = val === null || val === undefined ? '' : String(val);
          if (strVal.includes(',') || strVal.includes('\n') || strVal.includes('"')) {
            strVal = `"${strVal.replace(/"/g, '""')}"`;
          }
          return strVal;
        }).join(',')
      )
    ].join('\n');

    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export Summary Table to CSV
  const handleExportOverview = () => {
    const headers = [
      '광고주 계정',
      '고객 ID',
      '담당자',
      '비즈머니 잔액',
      '노출수',
      '클릭수',
      '클릭률',
      '평균CPC',
      '총비용',
      '전환수',
      '전환매출액',
      'ROAS',
      '전환당비용'
    ];

    const rows = sortedOverviewAccounts.map(acc => {
      const s = allAccountsStats[acc.customer_id] || {
        imp_cnt: 0, clk_cnt: 0, sales_amt: 0, purchase_ccnt: 0, purchase_conv_amt: 0,
        ctr: 0, cpc: 0, purchase_ror: 0, cp_conv: 0
      };
      const managerName = acc.manager_name || managerFallbackMap[acc.manager_account_no] || '미지정';
      return [
        acc.ad_account_name,
        acc.customer_id,
        managerName,
        acc.bizmoney || 0,
        s.imp_cnt,
        s.clk_cnt,
        `${s.ctr.toFixed(2)}%`,
        s.cpc,
        s.sales_amt,
        s.purchase_ccnt,
        s.purchase_conv_amt,
        `${s.purchase_ror.toFixed(2)}%`,
        s.cp_conv
      ];
    });

    const dateSuffix = `${startDate}_to_${endDate}`;
    downloadCSV(`advertiser_summary_${dateSuffix}.csv`, headers, rows);
  };

  // Export Detailed Tree Statistics to Flat CSV
  const handleExportDetail = () => {
    if (!selectedAccount) return;
    const headers = [
      '구분',
      '캠페인명',
      '광고그룹명',
      '소재/키워드/검색어명',
      '상태',
      '노출수',
      '클릭수',
      '클릭률',
      '평균CPC',
      '총비용',
      '전환수',
      '전환매출액',
      'ROAS',
      '전환당비용'
    ];

    const rows: any[][] = [];

    sortedCampaigns.forEach(camp => {
      rows.push([
        '캠페인',
        camp.name,
        '-',
        '-',
        camp.status === 'ELIGIBLE' ? '활성' : '중지',
        camp.imp_cnt || 0,
        camp.clk_cnt || 0,
        `${(camp.ctr || 0).toFixed(2)}%`,
        camp.cpc || 0,
        camp.sales_amt || 0,
        camp.purchase_ccnt || 0,
        camp.purchase_conv_amt || 0,
        `${(camp.purchase_ror || 0).toFixed(2)}%`,
        camp.cp_conv || 0
      ]);

      const childAdgs = sortedAdgroups.filter(ag => ag.ncc_campaign_id === camp.ncc_campaign_id);
      childAdgs.forEach(adg => {
        rows.push([
          '광고그룹',
          camp.name,
          adg.name,
          '-',
          adg.status === 'ELIGIBLE' ? '활성' : '중지',
          adg.imp_cnt || 0,
          adg.clk_cnt || 0,
          `${(adg.ctr || 0).toFixed(2)}%`,
          adg.cpc || 0,
          adg.sales_amt || 0,
          adg.purchase_ccnt || 0,
          adg.purchase_conv_amt || 0,
          `${(adg.purchase_ror || 0).toFixed(2)}%`,
          adg.cp_conv || 0
        ]);

        const childAds = sortedAds.filter(ad => ad.ncc_adgroup_id === adg.ncc_adgroup_id);
        childAds.forEach(ad => {
          rows.push([
            '광고소재',
            camp.name,
            adg.name,
            ad.name || ad.ncc_ad_id,
            ad.status === 'ELIGIBLE' ? '활성' : '중지',
            ad.imp_cnt || 0,
            ad.clk_cnt || 0,
            `${(ad.ctr || 0).toFixed(2)}%`,
            ad.cpc || 0,
            ad.sales_amt || 0,
            ad.purchase_ccnt || 0,
            ad.purchase_conv_amt || 0,
            `${(ad.purchase_ror || 0).toFixed(2)}%`,
            ad.cp_conv || 0
          ]);

          const childQueries = sortedShoppingQueries.filter(q => q.ncc_ad_id === ad.ncc_ad_id);
          childQueries.forEach(q => {
            rows.push([
              '쇼핑검색어',
              camp.name,
              adg.name,
              q.query,
              '-',
              q.imp_cnt || 0,
              q.clk_cnt || 0,
              `${(q.ctr || 0).toFixed(2)}%`,
              q.cpc || 0,
              q.sales_amt || 0,
              q.purchase_ccnt || 0,
              q.purchase_conv_amt || 0,
              `${(q.purchase_ror || 0).toFixed(2)}%`,
              q.cp_conv || 0
            ]);
          });
        });

        const childKeywords = sortedKeywords.filter(kw => kw.ncc_adgroup_id === adg.ncc_adgroup_id);
        childKeywords.forEach(kw => {
          rows.push([
            '키워드',
            camp.name,
            adg.name,
            kw.keyword,
            kw.status === 'ELIGIBLE' ? '활성' : '중지',
            kw.imp_cnt || 0,
            kw.clk_cnt || 0,
            `${(kw.ctr || 0).toFixed(2)}%`,
            kw.cpc || 0,
            kw.sales_amt || 0,
            kw.purchase_ccnt || 0,
            kw.purchase_conv_amt || 0,
            `${(kw.purchase_ror || 0).toFixed(2)}%`,
            kw.cp_conv || 0
          ]);
        });
      });
    });

    const dateSuffix = `${startDate}_to_${endDate}`;
    const sanitizedAccName = selectedAccount.ad_account_name.replace(/[^a-zA-Z0-9가-힣_]/g, '_');
    downloadCSV(`${sanitizedAccName}_detail_${dateSuffix}.csv`, headers, rows);
  };

  // 7.5. Profile settings & Logout & Admin User Management
  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const loadProfilesList = async () => {
    if (userProfile?.role !== 'admin') return;
    const { data } = await supabase.from('user_profiles').select('*').order('email');
    if (data) {
      setProfilesList(data);
    }
  };

  useEffect(() => {
    if (showSettingsModal) {
      if (userProfile?.role === 'admin') {
        loadProfilesList();
      }
      setOwnApiKey(userProfile?.naver_api_key || '');
      setOwnSecretKey(userProfile?.naver_secret_key || '');
      setOwnCustomerId(userProfile?.naver_customer_id ? userProfile.naver_customer_id.toString() : '');
    }
  }, [showSettingsModal, userProfile]);

  const handleUpdateProfile = async (id: string, updatedRole: string, updatedManagerNo: number | string) => {
    const managerNoVal = updatedManagerNo === '' || updatedManagerNo === 'none' ? null : parseInt(updatedManagerNo.toString(), 10);
    
    // Get the current session to extract the access token
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      alert('세션이 만료되었습니다. 다시 로그인해 주세요.');
      return;
    }

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          userId: id,
          role: updatedRole,
          managerAccountNo: managerNoVal
        })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || '알 수 없는 오류가 발생했습니다.');
      }

      alert('설정이 성공적으로 저장되었습니다.');
      loadProfilesList();
      // If updating current user's profile, update the local userProfile state too
      if (id === userProfile.id) {
        setUserProfile((prev: any) => ({ ...prev, role: updatedRole, manager_account_no: managerNoVal }));
      }
    } catch (err: any) {
      alert('설정 저장 실패: ' + err.message);
    }
  };

  const handleUpdateOwnApiKeys = async () => {
    if (!userProfile) return;
    setSavingOwnKeys(true);
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          naver_api_key: ownApiKey === '' ? null : ownApiKey,
          naver_secret_key: ownSecretKey === '' ? null : ownSecretKey,
          naver_customer_id: ownCustomerId === '' ? null : parseInt(ownCustomerId, 10)
        })
        .eq('id', userProfile.id);

      if (error) throw error;

      alert('네이버 API 연동 키가 성공적으로 업데이트되었습니다.');
      setUserProfile((prev: any) => ({
        ...prev,
        naver_api_key: ownApiKey === '' ? null : ownApiKey,
        naver_secret_key: ownSecretKey === '' ? null : ownSecretKey,
        naver_customer_id: ownCustomerId === '' ? null : parseInt(ownCustomerId, 10)
      }));
    } catch (err: any) {
      alert('API 키 업데이트 실패: ' + err.message);
    } finally {
      setSavingOwnKeys(false);
    }
  };

  const toggleCampaign = (id: string) => {
    setExpandedCampaigns(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleAdgroup = (id: string) => {
    setExpandedAdgroups(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Preset Date range selection handlers
  const setPresetRange = (type: 'yesterday' | '7days' | '14days' | '30days' | 'lastMonth' | 'monthBeforeLast') => {
    setSelectedPreset(type);
    const today = new Date();
    if (type === 'yesterday') {
      const yesterday = format(subDays(today, 1), 'yyyy-MM-dd');
      setStartDate(yesterday);
      setEndDate(yesterday);
    } else if (type === '7days') {
      setStartDate(format(subDays(today, 7), 'yyyy-MM-dd'));
      setEndDate(format(subDays(today, 1), 'yyyy-MM-dd'));
    } else if (type === '14days') {
      setStartDate(format(subDays(today, 14), 'yyyy-MM-dd'));
      setEndDate(format(subDays(today, 1), 'yyyy-MM-dd'));
    } else if (type === '30days') {
      setStartDate(format(subDays(today, 30), 'yyyy-MM-dd'));
      setEndDate(format(subDays(today, 1), 'yyyy-MM-dd'));
    } else if (type === 'lastMonth') {
      const lastMonthDate = subMonths(today, 1);
      setStartDate(format(startOfMonth(lastMonthDate), 'yyyy-MM-dd'));
      setEndDate(format(endOfMonth(lastMonthDate), 'yyyy-MM-dd'));
    } else if (type === 'monthBeforeLast') {
      const monthBeforeLastDate = subMonths(today, 2);
      setStartDate(format(startOfMonth(monthBeforeLastDate), 'yyyy-MM-dd'));
      setEndDate(format(endOfMonth(monthBeforeLastDate), 'yyyy-MM-dd'));
    }
  };

  // Removed metricLabelMap, metricColorMap, and getMetricIcon (moved to module scope)

  const toggleChartMetric = (m: string) => {
    setSelectedChartMetrics(prev => {
      if (prev.includes(m)) {
        if (prev.length === 1) return prev;
        return prev.filter(x => x !== m);
      } else {
        return [...prev, m];
      }
    });
  };

  // Removed formatMetricValue (moved to module scope)

  // Clickable Header Helper
  const SortableHeader = ({ field, label, widthClass, textRight }: { field: string, label: string, widthClass: string, textRight?: boolean }) => {
    const isSorted = sortField === field;
    return (
      <th 
        onClick={() => handleSort(field)}
        className={`px-2 py-3 hover:bg-neutral-800/50 hover:text-white cursor-pointer select-none transition-colors border-r border-neutral-900/10 ${widthClass} ${textRight ? 'text-right' : ''}`}
      >
        <div className={`flex items-center gap-1 whitespace-nowrap ${textRight ? 'justify-end' : ''}`}>
          <span className="whitespace-nowrap">{label}</span>
          <span className="text-[9px] text-neutral-500">
            {isSorted ? (sortOrder === 'asc' ? '▲' : '▼') : <ChevronsUpDown size={9} />}
          </span>
        </div>
      </th>
    );
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-center text-neutral-400 font-sans">
        <RefreshCw className="animate-spin text-blue-500 mb-3" size={24} />
        <p className="text-xs font-semibold">인증 확인 중...</p>
      </div>
    );
  }

  if (userProfile?.role === 'pending') {
    return (
      <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-center text-neutral-400 font-sans p-4 relative overflow-hidden">
        {/* Background glow effects */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none animate-pulse"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none animate-pulse"></div>

        <div className="w-full max-w-md bg-neutral-950 border border-neutral-850 rounded-2xl shadow-2xl p-8 text-center relative z-10 backdrop-blur-md">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="text-amber-500" size={32} />
          </div>
          <h2 className="text-lg font-bold text-white mb-2">승인 대기 중</h2>
          <p className="text-neutral-400 text-xs leading-relaxed mb-6">
            회원가입 요청이 접수되었습니다.<br />
            관리자 승인 후에 서비스를 이용하실 수 있습니다. 잠시만 기다려 주세요!
          </p>
          <div className="flex flex-col gap-2">
            <div className="px-4 py-3 bg-neutral-900/60 border border-neutral-850 rounded-xl text-left text-[11px] text-neutral-400 break-all space-y-1">
              <div><strong>계정 이메일:</strong> {userProfile.email}</div>
              {userProfile.naver_customer_id && <div><strong>네이버 광고주 ID:</strong> {userProfile.naver_customer_id}</div>}
            </div>
            <button
              onClick={handleLogout}
              className="w-full mt-4 py-2.5 bg-neutral-850 hover:bg-neutral-800 text-white font-bold rounded-xl shadow-lg transition-all text-xs cursor-pointer flex items-center justify-center gap-1.5"
            >
              로그아웃 <LogOut size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderOverview = () => {
    const SortableOverviewHeader = ({ field, label, widthClass, textRight }: { field: string, label: string, widthClass: string, textRight?: boolean }) => {
      const isSorted = overviewSortField === field;
      return (
        <th 
          onClick={() => handleOverviewSort(field)}
          className={`px-2 py-3 hover:bg-neutral-800/50 hover:text-white cursor-pointer select-none transition-colors border-r border-neutral-900/10 ${widthClass} ${textRight ? 'text-right' : ''}`}
        >
          <div className={`flex items-center gap-1 whitespace-nowrap ${textRight ? 'justify-end' : ''}`}>
            <span>{label}</span>
            <span className="text-[9px] text-neutral-500">
              {isSorted ? (overviewSortOrder === 'asc' ? '▲' : '▼') : <ChevronsUpDown size={9} />}
            </span>
          </div>
        </th>
      );
    };

    return (
      <div className="space-y-5">
        {/* Header Controls for Overview */}
        <header className="flex flex-col xl:flex-row justify-between items-start xl:items-end gap-3 pb-1">
          <div>
            <h1 className={`text-xl font-bold tracking-tight ${theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>
              전체 계정 종합 요약
            </h1>
            <p className="text-neutral-500 text-[10px] font-semibold">모든 연동 계정의 성과 및 잔액 일괄 확인</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            {/* Date Presets */}
            <div className={`flex rounded-lg p-0.5 text-[10px] font-semibold border ${
              theme === 'dark' ? 'bg-neutral-950 border-neutral-800' : 'bg-gray-100 border-gray-200'
            }`}>
              {[
                { id: 'yesterday', label: '어제' },
                { id: '7days', label: '7일' },
                { id: '14days', label: '14일' },
                { id: '30days', label: '30일' },
                { id: 'lastMonth', label: '전월', highlight: true },
                { id: 'monthBeforeLast', label: '전전월', highlight: true }
              ].map(p => {
                const isActive = selectedPreset === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setPresetRange(p.id as any)}
                    className={`px-2 py-1 rounded transition-all cursor-pointer ${
                      isActive
                        ? theme === 'dark'
                          ? 'bg-blue-600 text-white font-semibold shadow-md'
                          : 'bg-white text-blue-600 shadow-sm font-semibold'
                        : p.highlight 
                          ? 'text-blue-500 hover:bg-neutral-900/20' 
                          : 'text-neutral-500 hover:text-neutral-900'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* Date Range Selector */}
            <div className={`flex items-center rounded-lg px-2 py-0.5 border ${
              theme === 'dark' ? 'bg-neutral-950 border-neutral-800' : 'bg-white border-gray-200'
            }`}>
              <Calendar size={12} className="text-neutral-500 mr-1.5" />
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setSelectedPreset('custom');
                }}
                className={`bg-transparent border-none outline-none py-0.5 cursor-pointer w-22 text-[10px] focus:ring-0 ${
                  theme === 'dark' ? 'text-neutral-300' : 'text-neutral-700'
                }`}
              />
              <span className="text-neutral-600 mx-0.5">~</span>
              <input 
                type="date" 
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setSelectedPreset('custom');
                }}
                className={`bg-transparent border-none outline-none py-0.5 cursor-pointer w-22 text-[10px] focus:ring-0 ${
                  theme === 'dark' ? 'text-neutral-300' : 'text-neutral-700'
                }`}
              />
            </div>

            {/* Manager Filter for Admin */}
            {userProfile?.role === 'admin' && (
              <div className={`flex items-center rounded-lg px-2 py-1.5 border text-[10px] ${
                theme === 'dark' ? 'bg-neutral-950 border-neutral-800 text-neutral-300' : 'bg-white border-gray-200 text-neutral-700'
              }`}>
                <span className="mr-1.5 font-bold text-[9px] text-neutral-500">담당자:</span>
                <select
                  value={selectedManagerFilter}
                  onChange={(e) => setSelectedManagerFilter(e.target.value)}
                  className="bg-transparent border-none outline-none cursor-pointer focus:ring-0 p-0 text-[10px] font-semibold font-sans [color-scheme:dark]"
                >
                  <option value="all" className={theme === 'dark' ? 'bg-neutral-950 text-neutral-200' : 'bg-white text-neutral-800'}>
                    전체 보기
                  </option>
                  {Object.entries(dynamicManagers).map(([no, name]) => (
                    <option key={no} value={no} className={theme === 'dark' ? 'bg-neutral-950 text-neutral-200' : 'bg-white text-neutral-800'}>
                      {name} ({no})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Bizmoney Sync Button */}
            <button 
              onClick={syncAllBizmoney}
              disabled={syncingBizmoney}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:from-emerald-800 text-white font-bold rounded-lg shadow-md transition-all text-[10px] cursor-pointer"
            >
              <RefreshCw size={10} className={syncingBizmoney ? "animate-spin" : ""} />
              {syncingBizmoney ? '잔액 갱신 중...' : '비즈머니 잔액 갱신'}
            </button>

            {/* Export Summary Table to CSV */}
            <button
              onClick={handleExportOverview}
              className={`flex items-center gap-1.5 px-3 py-1.5 border font-bold rounded-lg shadow-md transition-all text-[10px] cursor-pointer ${
                theme === 'dark' 
                  ? 'bg-neutral-950 border-neutral-800 hover:bg-neutral-900 text-neutral-300 hover:text-white' 
                  : 'bg-white border-gray-200 hover:bg-gray-50 text-neutral-700 hover:text-neutral-900'
              }`}
            >
              <DollarSign size={10} />
              엑셀/CSV 다운로드
            </button>

            {/* Theme Toggle Button */}
            <button 
              onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
              className={`p-1.5 border rounded-lg transition-colors cursor-pointer ${
                theme === 'dark' 
                  ? 'bg-neutral-950 border-neutral-800 hover:bg-neutral-900 text-amber-400' 
                  : 'bg-white border-gray-200 hover:bg-gray-100 text-indigo-600'
              }`}
            >
              {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
            </button>
          </div>
        </header>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard 
            metric={card1Metric} 
            value={formatMetricValue(card1Metric, overallSummary[card1Metric as keyof typeof overallSummary] || 0)} 
            icon={getMetricIcon(card1Metric)} 
            theme={theme} 
            onMetricChange={setCard1Metric} 
            metricLabelMap={metricLabelMap} 
          />
          <SummaryCard 
            metric={card2Metric} 
            value={formatMetricValue(card2Metric, overallSummary[card2Metric as keyof typeof overallSummary] || 0)} 
            icon={getMetricIcon(card2Metric)} 
            theme={theme} 
            onMetricChange={setCard2Metric} 
            metricLabelMap={metricLabelMap} 
          />
          <SummaryCard 
            metric={card3Metric} 
            value={formatMetricValue(card3Metric, overallSummary[card3Metric as keyof typeof overallSummary] || 0)} 
            icon={getMetricIcon(card3Metric)} 
            theme={theme} 
            onMetricChange={setCard3Metric} 
            metricLabelMap={metricLabelMap} 
          />
          <SummaryCard 
            metric={card4Metric} 
            value={formatMetricValue(card4Metric, overallSummary[card4Metric as keyof typeof overallSummary] || 0)} 
            icon={getMetricIcon(card4Metric)} 
            theme={theme} 
            onMetricChange={setCard4Metric} 
            metricLabelMap={metricLabelMap} 
          />
        </div>

        {/* Accounts Overview Table */}
        <div className={`rounded-xl border shadow-xl overflow-hidden ${
          theme === 'dark' ? 'bg-neutral-950 border-neutral-850' : 'bg-white border-gray-200'
        }`}>
          <div className="w-full overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[1000px] border-collapse text-[11px]">
              <thead>
                <tr className={`border-b text-[10px] uppercase tracking-wider font-bold ${
                  theme === 'dark' ? 'bg-neutral-950 border-neutral-850 text-neutral-500' : 'bg-gray-100 border-gray-200 text-neutral-500'
                }`}>
                  <SortableOverviewHeader field="ad_account_name" label="광고주 계정" widthClass="w-[18%]" />
                  <SortableOverviewHeader field="bizmoney" label="비즈머니 잔액" widthClass="w-[11%]" textRight />
                  <SortableOverviewHeader field="imp_cnt" label="노출수" widthClass="w-[8%]" textRight />
                  <SortableOverviewHeader field="clk_cnt" label="클릭수" widthClass="w-[6%]" textRight />
                  <SortableOverviewHeader field="ctr" label="클릭률" widthClass="w-[6%]" textRight />
                  <SortableOverviewHeader field="cpc" label="평균CPC" widthClass="w-[8%]" textRight />
                  <SortableOverviewHeader field="sales_amt" label="총비용" widthClass="w-[9%]" textRight />
                  <SortableOverviewHeader field="purchase_ccnt" label="전환수" widthClass="w-[7%]" textRight />
                  <SortableOverviewHeader field="purchase_conv_amt" label="전환매출액" widthClass="w-[10%]" textRight />
                  <SortableOverviewHeader field="purchase_ror" label="ROAS" widthClass="w-[7%]" textRight />
                  <SortableOverviewHeader field="cp_conv" label="전환당비용" widthClass="w-[10%]" textRight />
                  <th className="px-2 py-3 text-center w-[5%] whitespace-nowrap">상세</th>
                </tr>
              </thead>
              <tbody className={`divide-y font-semibold ${
                theme === 'dark' ? 'divide-neutral-900/60 text-neutral-300' : 'divide-gray-100 text-neutral-700'
              }`}>
                {loadingOverview ? (
                  <tr>
                    <td colSpan={12} className="px-6 py-12 text-center text-neutral-500">
                      계정 종합 요약 정보를 불러오는 중입니다...
                    </td>
                  </tr>
                ) : sortedOverviewAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-6 py-12 text-center text-neutral-500">
                      연동된 계정이 없습니다.
                    </td>
                  </tr>
                ) : (
                  sortedOverviewAccounts.map(acc => {
                    const s = allAccountsStats[acc.customer_id] || {
                      imp_cnt: 0, clk_cnt: 0, sales_amt: 0, purchase_ccnt: 0, purchase_conv_amt: 0,
                      ctr: 0, cpc: 0, purchase_ror: 0, cp_conv: 0
                    };
                    return (
                      <tr key={acc.customer_id} className={`transition-colors ${
                        theme === 'dark' ? 'hover:bg-neutral-900/40 text-neutral-300' : 'hover:bg-gray-50 text-neutral-700'
                      }`}>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col">
                            <span className={`font-bold ${theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>{acc.ad_account_name}</span>
                            <span className="text-[8.5px] text-neutral-500 font-normal mt-0.5">ID: {acc.customer_id}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-emerald-500 font-bold whitespace-nowrap border-r border-neutral-900/10">
                          {Math.round(acc.bizmoney || 0).toLocaleString()}원
                        </td>
                        <td className="px-2 py-2.5 text-right font-mono whitespace-nowrap border-r border-neutral-900/10">{formatMetricValue('imp_cnt', s.imp_cnt)}</td>
                        <td className="px-2 py-2.5 text-right font-mono whitespace-nowrap border-r border-neutral-900/10">{formatMetricValue('clk_cnt', s.clk_cnt)}</td>
                        <td className="px-2 py-2.5 text-right font-mono whitespace-nowrap border-r border-neutral-900/10">{formatMetricValue('ctr', s.ctr)}</td>
                        <td className="px-2 py-2.5 text-right font-mono whitespace-nowrap border-r border-neutral-900/10">{formatMetricValue('cpc', s.cpc)}</td>
                        <td className="px-2 py-2.5 text-right font-mono whitespace-nowrap border-r border-neutral-900/10">{formatMetricValue('sales_amt', s.sales_amt)}</td>
                        <td className="px-2 py-2.5 text-right font-mono whitespace-nowrap border-r border-neutral-900/10">{formatMetricValue('purchase_ccnt', s.purchase_ccnt)}</td>
                        <td className="px-2 py-2.5 text-right font-mono whitespace-nowrap border-r border-neutral-900/10">{formatMetricValue('purchase_conv_amt', s.purchase_conv_amt)}</td>
                        <td className="px-2 py-2.5 text-right font-mono whitespace-nowrap border-r border-neutral-900/10">{formatMetricValue('purchase_ror', s.purchase_ror)}</td>
                        <td className="px-2 py-2.5 text-right font-mono whitespace-nowrap border-r border-neutral-900/10">{formatMetricValue('cp_conv', s.cp_conv)}</td>
                        <td className="px-2 py-2.5 text-center whitespace-nowrap">
                          <button
                            onClick={() => {
                              setSelectedAccount(acc);
                              setActiveView('detail');
                            }}
                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded text-[9px] cursor-pointer shadow-sm hover:shadow transition-all"
                          >
                            보기
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`flex h-screen overflow-hidden text-xs antialiased font-sans transition-colors duration-300 ${
      theme === 'dark' ? 'bg-neutral-900 text-neutral-100 dark' : 'bg-gray-50 text-neutral-800'
    }`}>
      
      {/* Sidebar */}
      <div className={`w-60 border-r flex flex-col flex-shrink-0 transition-colors duration-300 ${
        theme === 'dark' ? 'bg-neutral-950 border-neutral-800' : 'bg-white border-gray-200'
      }`}>
        <div className={`p-5 border-b ${theme === 'dark' ? 'border-neutral-800' : 'border-gray-150'}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <BarChart3 className="text-white" size={15} />
            </div>
            <div>
              <div className={`font-bold text-xs leading-tight ${theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>NAV AD</div>
              <div className="text-[9px] text-neutral-500 font-bold tracking-wider uppercase">PERFORMANCE DASH</div>
            </div>
          </div>
        </div>
        
        {/* Search Input */}
        <div className="p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" size={12} />
            <input 
              type="text" 
              placeholder="광고주 검색..." 
              className={`w-full pl-8 pr-3 py-1.5 border rounded-lg outline-none text-xs transition-all ${
                theme === 'dark' 
                  ? 'bg-neutral-900 border-neutral-850 focus:border-blue-500 text-neutral-200' 
                  : 'bg-gray-100 border-gray-200 focus:border-blue-500 text-neutral-800'
              }`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Advertiser List */}
        <div className="overflow-y-auto flex-1 p-2 space-y-0.5 custom-scrollbar">
          {/* All Accounts Tab */}
          <div className="px-1 pb-1 border-b border-neutral-905/10 mb-1.5">
            <button
              onClick={() => setActiveView('overview')}
              className={`w-full text-left px-3 py-2 rounded-lg transition-all flex items-center gap-2.5 relative group border text-[11px] ${
                activeView === 'overview'
                  ? theme === 'dark'
                    ? 'bg-blue-600/15 text-blue-400 font-semibold border-blue-500/30'
                    : 'bg-blue-50 text-blue-600 font-semibold border-blue-200'
                  : theme === 'dark'
                    ? 'hover:bg-neutral-900 text-neutral-400 hover:text-neutral-200 border-transparent'
                    : 'hover:bg-gray-100 text-neutral-600 hover:text-neutral-900 border-transparent'
              }`}
            >
              {activeView === 'overview' && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-blue-500 rounded-r-md"></div>
              )}
              <Activity size={12} className={activeView === 'overview' ? "text-blue-500" : "text-neutral-500"} />
              <div className="min-w-0 flex-1 flex flex-col text-left">
                <span className="font-bold">🏠 전체 계정 종합 요약</span>
              </div>
            </button>
          </div>

          {filteredAccounts.length === 0 && !loading && (
            <p className="text-neutral-500 p-2 text-center text-[10px]">결과가 없습니다.</p>
          )}
          {filteredAccounts.map(acc => {
            const isSelected = activeView === 'detail' && selectedAccount?.customer_id === acc.customer_id;
            return (
              <button
                key={acc.customer_id}
                onClick={() => {
                  setSelectedAccount(acc);
                  setActiveView('detail');
                }}
                className={`w-full text-left px-3 py-2 rounded-lg transition-all flex items-center gap-2.5 relative group border text-[11px] ${
                  isSelected
                    ? theme === 'dark'
                      ? 'bg-blue-600/15 text-blue-400 font-semibold border-blue-500/30'
                      : 'bg-blue-50 text-blue-600 font-semibold border-blue-200'
                    : theme === 'dark'
                      ? 'hover:bg-neutral-900 text-neutral-400 hover:text-neutral-200 border-transparent'
                      : 'hover:bg-gray-100 text-neutral-600 hover:text-neutral-900 border-transparent'
                }`}
              >
                {isSelected && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-blue-500 rounded-r-md"></div>
                )}
                <Users size={12} className={`flex-shrink-0 ${isSelected ? "text-blue-500" : "text-neutral-500"}`} />
                <div className="min-w-0 flex-1 flex flex-col text-left">
                  <span className="truncate w-full font-bold">{acc.ad_account_name}</span>
                  <div className="flex items-center justify-between text-[8px] mt-0.5 font-normal">
                    <span className={isSelected ? 'text-blue-400/80' : 'text-neutral-500'}>
                      ID: {acc.customer_id}
                    </span>
                    <span className={isSelected ? 'text-blue-400/80' : 'text-neutral-500'}>
                      담당: {acc.manager_name || managerFallbackMap[acc.manager_account_no] || '미지정'}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Sidebar Footer */}
        <div className={`p-3 border-t flex items-center justify-between gap-2 transition-colors duration-300 ${
          theme === 'dark' ? 'border-neutral-900 bg-neutral-950/30' : 'border-gray-150 bg-gray-50/50'
        }`}>
          <div className="min-w-0 flex-1">
            <p className={`font-semibold truncate text-[10px] ${theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>
              {userProfile?.email}
            </p>
            <p className="text-[8.5px] text-neutral-500 font-semibold mt-0.5 uppercase tracking-wider">
              {userProfile?.role === 'admin' 
                ? '관리자 (Admin)' 
                : `담당: ${dynamicManagers[userProfile?.manager_account_no] || '미배정'}`}
            </p>
          </div>
          
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setShowSettingsModal(true)}
              className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                theme === 'dark'
                  ? 'bg-neutral-900 border-neutral-850 hover:bg-neutral-800 text-neutral-400 hover:text-white'
                  : 'bg-white border-gray-200 hover:bg-gray-50 text-neutral-600 hover:text-neutral-950'
              }`}
              title="계정 및 사용자 설정"
            >
              <Settings size={12} />
            </button>
            
            <button
              onClick={handleLogout}
              className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                theme === 'dark'
                  ? 'bg-neutral-900 border-neutral-850 hover:bg-neutral-800 text-red-400 hover:text-red-300'
                  : 'bg-white border-gray-200 hover:bg-gray-50 text-red-600 hover:text-red-500'
              }`}
              title="로그아웃"
            >
              <LogOut size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        <div className="max-w-7xl w-full mx-auto p-5 xl:p-6 space-y-5 flex-1">
          
          {/* DB Schema Error Warning Alert */}
          {dbError && (
            <div className="flex items-start gap-3 p-3 bg-red-950/10 border border-red-900/30 rounded-xl text-red-400 animate-pulse text-[11px]">
              <AlertCircle className="flex-shrink-0 mt-0.5" size={14} />
              <div>
                <p className="font-semibold text-red-300">데이터베이스 설정 오류</p>
                <p className="mt-0.5 text-neutral-400">{dbError}</p>
              </div>
            </div>
          )}

          {/* Sync Progress Status Alert */}
          {syncing && syncMessage && (
            <div className={`flex items-start gap-3 p-3 rounded-xl text-[11px] border ${
              theme === 'dark' 
                ? 'bg-blue-950/15 border-blue-900/30 text-blue-400' 
                : 'bg-blue-50 border-blue-200 text-blue-700'
            }`}>
              <RefreshCw className="flex-shrink-0 mt-0.5 animate-spin" size={14} />
              <div>
                <p className="font-semibold">실시간 동기화 진행 중 ({syncTime}초 경과)</p>
                <p className="mt-0.5 text-neutral-500">{syncMessage}</p>
              </div>
            </div>
          )}

          {activeView === 'overview' ? renderOverview() : (
            <>
              {/* Header Controls */}
              <header className="flex flex-col xl:flex-row justify-between items-start xl:items-end gap-3 pb-1">
                <div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setActiveView('overview')}
                      className={`px-2.5 py-1 rounded-lg border text-[9px] font-bold transition-all cursor-pointer hover:shadow flex items-center gap-1 ${
                        theme === 'dark' 
                          ? 'bg-neutral-950 border-neutral-855 hover:bg-neutral-900 text-neutral-300' 
                          : 'bg-white border-gray-200 hover:bg-gray-50 text-neutral-700'
                      }`}
                    >
                      <span>⬅️ 전체 목록</span>
                    </button>
                    <button
                      onClick={handleExportDetail}
                      className={`px-2.5 py-1 rounded-lg border text-[9px] font-bold transition-all cursor-pointer hover:shadow flex items-center gap-1 ${
                        theme === 'dark' 
                          ? 'bg-neutral-950 border-neutral-855 hover:bg-neutral-900 text-neutral-300 hover:text-white' 
                          : 'bg-white border-gray-200 hover:bg-gray-50 text-neutral-700 hover:text-neutral-900'
                      }`}
                    >
                      <DollarSign size={9} />
                      엑셀/CSV 다운로드
                    </button>
                    <h1 className={`text-xl font-bold tracking-tight ${theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>
                      {selectedAccount ? selectedAccount.ad_account_name : '광고주를 선택해주세요'}
                    </h1>
                  </div>
                  <p className="text-neutral-500 text-[10px] font-semibold mt-0.5">상세 광고 성과 대시보드</p>
                </div>
            
            <div className="flex flex-wrap items-center gap-2">
              {/* Date Presets (Pill tabs) */}
              <div className={`flex rounded-lg p-0.5 text-[10px] font-semibold border ${
                theme === 'dark' ? 'bg-neutral-950 border-neutral-800' : 'bg-gray-100 border-gray-200'
              }`}>
                {[
                  { id: 'yesterday', label: '어제' },
                  { id: '7days', label: '7일' },
                  { id: '14days', label: '14일' },
                  { id: '30days', label: '30일' },
                  { id: 'lastMonth', label: '전월', highlight: true },
                  { id: 'monthBeforeLast', label: '전전월', highlight: true }
                ].map(p => {
                  const isActive = selectedPreset === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setPresetRange(p.id as any)}
                      className={`px-2 py-1 rounded transition-all cursor-pointer ${
                        isActive
                          ? theme === 'dark'
                            ? 'bg-blue-600 text-white font-semibold shadow-md'
                            : 'bg-white text-blue-600 shadow-sm font-semibold'
                          : p.highlight 
                            ? 'text-blue-500 hover:bg-neutral-900/20' 
                            : 'text-neutral-500 hover:text-neutral-900'
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>

              {/* Date Range Selector */}
              <div className={`flex items-center rounded-lg px-2 py-0.5 border ${
                theme === 'dark' ? 'bg-neutral-950 border-neutral-800' : 'bg-white border-gray-200'
              }`}>
                <Calendar size={12} className="text-neutral-500 mr-1.5" />
                <input 
                  type="date" 
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setSelectedPreset('custom');
                  }}
                  className={`bg-transparent border-none outline-none py-0.5 cursor-pointer w-22 text-[10px] focus:ring-0 ${
                    theme === 'dark' ? 'text-neutral-300' : 'text-neutral-700'
                  }`}
                />
                <span className="text-neutral-600 mx-0.5">~</span>
                <input 
                  type="date" 
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setSelectedPreset('custom');
                  }}
                  className={`bg-transparent border-none outline-none py-0.5 cursor-pointer w-22 text-[10px] focus:ring-0 ${
                    theme === 'dark' ? 'text-neutral-300' : 'text-neutral-700'
                  }`}
                />
              </div>

              {/* Sync Controls */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer text-[10px] select-none text-neutral-400 hover:text-neutral-200">
                  <input
                    type="checkbox"
                    checked={syncHierarchy}
                    onChange={(e) => setSyncHierarchy(e.target.checked)}
                    disabled={syncing}
                    className="rounded border-neutral-750 bg-neutral-900 text-blue-500 focus:ring-blue-500/30 focus:ring-offset-neutral-900 focus:ring-2 w-3.5 h-3.5 cursor-pointer disabled:opacity-50"
                  />
                  <span className="whitespace-nowrap">신규 구조 갱신 (새 캠페인/키워드 추가 시)</span>
                </label>
                
                {/* Sync Button */}
                <button 
                  onClick={handleSync}
                  disabled={syncing || !selectedAccount}
                  className="flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:from-blue-800 text-white font-bold rounded-lg shadow-md transition-all text-[10px] cursor-pointer"
                >
                  <RefreshCw size={10} className={syncing ? "animate-spin" : ""} />
                  {syncing ? `동기화 중 (${syncTime}초)` : '동기화'}
                </button>
              </div>

              {/* Theme Toggle Button */}
              <button 
                onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
                className={`p-1.5 border rounded-lg transition-colors cursor-pointer ${
                  theme === 'dark' 
                    ? 'bg-neutral-950 border-neutral-800 hover:bg-neutral-900 text-amber-400' 
                    : 'bg-white border-gray-200 hover:bg-gray-100 text-indigo-600'
                }`}
                title="다크/라이트 테마 변경"
              >
                {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
              </button>
            </div>
          </header>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard 
              metric={card1Metric} 
              value={formatMetricValue(card1Metric, summary[card1Metric as keyof typeof summary] || 0)} 
              icon={getMetricIcon(card1Metric)} 
              theme={theme} 
              onMetricChange={setCard1Metric} 
              metricLabelMap={metricLabelMap} 
            />
            <SummaryCard 
              metric={card2Metric} 
              value={formatMetricValue(card2Metric, summary[card2Metric as keyof typeof summary] || 0)} 
              icon={getMetricIcon(card2Metric)} 
              theme={theme} 
              onMetricChange={setCard2Metric} 
              metricLabelMap={metricLabelMap} 
            />
            <SummaryCard 
              metric={card3Metric} 
              value={formatMetricValue(card3Metric, summary[card3Metric as keyof typeof summary] || 0)} 
              icon={getMetricIcon(card3Metric)} 
              theme={theme} 
              onMetricChange={setCard3Metric} 
              metricLabelMap={metricLabelMap} 
            />
            <SummaryCard 
              metric={card4Metric} 
              value={formatMetricValue(card4Metric, summary[card4Metric as keyof typeof summary] || 0)} 
              icon={getMetricIcon(card4Metric)} 
              theme={theme} 
              onMetricChange={setCard4Metric} 
              metricLabelMap={metricLabelMap} 
            />
          </div>

          {/* Dynamic Interactive SVG Trend Graph */}
          <div className={`p-4 rounded-xl border transition-all ${
            theme === 'dark' ? 'bg-neutral-950 border-neutral-800' : 'bg-white border-gray-200'
          }`}>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
              <div>
                <div className="font-bold text-neutral-400 text-[11px] uppercase tracking-wide">일자별 광고 데이터 추이 그래프</div>
                {/* Metric Checkboxes */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {Object.entries(metricLabelMap).map(([key, label]) => {
                    const isSelected = selectedChartMetrics.includes(key);
                    const colors = metricColorMap[key] || { hex: '#3b82f6', bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400' };
                    return (
                      <button
                        key={key}
                        onClick={() => toggleChartMetric(key)}
                        className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
                          isSelected
                            ? `${colors.bg} ${colors.border} ${colors.text}`
                            : theme === 'dark'
                              ? 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                              : 'bg-white border-gray-200 text-neutral-600 hover:text-neutral-800'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.hex }}></span>
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* SVG Trend Line Graph */}
            <div className="relative">
              {dailyChartData.length === 0 ? (
                <div className="h-32 flex items-center justify-center text-neutral-500">조회된 데이터가 없습니다.</div>
              ) : (
                <svg 
                  viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                  className="w-full h-[160px] overflow-visible select-none"
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                >
                  <defs>
                    {selectedChartMetrics.map(metric => {
                      const color = metricColorMap[metric]?.hex || '#3b82f6';
                      return (
                        <linearGradient key={metric} id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
                          <stop offset="100%" stopColor={color} stopOpacity="0" />
                        </linearGradient>
                      );
                    })}
                  </defs>

                  {/* Horizontal Grid lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((r, i) => {
                    const y = paddingTop + r * plotHeight;
                    return (
                      <line 
                        key={i} 
                        x1={paddingLeft} 
                        y1={y} 
                        x2={svgWidth - paddingRight} 
                        y2={y} 
                        stroke={theme === 'dark' ? '#262626' : '#e5e7eb'} 
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                    );
                  })}

                  {/* Connecting Lines & Areas */}
                  {multipleChartLines.map((line) => (
                    <g key={line.metric}>
                      {/* Only draw area if only 1 metric is selected to prevent messy overlapping */}
                      {selectedChartMetrics.length === 1 && line.areaD && (
                        <path d={line.areaD} fill={`url(#grad-${line.metric})`} />
                      )}
                      {line.pathD && (
                        <path 
                          d={line.pathD} 
                          fill="none" 
                          stroke={line.color} 
                          strokeWidth="2.5" 
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )}
                    </g>
                  ))}

                  {/* Data Points */}
                  {multipleChartLines.map((line) => {
                    return line.points.map((pt, idx) => (
                      <circle 
                        key={`${line.metric}-${idx}`}
                        cx={pt.x}
                        cy={pt.y}
                        r={hoveredIndex === idx ? 5.5 : 2.5}
                        fill={hoveredIndex === idx ? line.color : theme === 'dark' ? '#171717' : '#ffffff'}
                        stroke={line.color}
                        strokeWidth={hoveredIndex === idx ? 2 : 1}
                        className="transition-all duration-100"
                      />
                    ));
                  })}

                  {/* X Axis Labels */}
                  {multipleChartLines[0]?.points.map((pt, idx) => {
                    // Reduce date labels density on wide ranges to avoid overlapping
                    const density = Math.ceil(multipleChartLines[0].points.length / 12);
                    if (idx % density !== 0 && idx !== multipleChartLines[0].points.length - 1) return null;
                    return (
                      <text
                        key={idx}
                        x={pt.x}
                        y={svgHeight - 5}
                        textAnchor="middle"
                        fill="#737373"
                        fontSize="9"
                        fontWeight="semibold"
                      >
                        {pt.label}
                      </text>
                    );
                  })}

                  {/* Hover tracker line */}
                  {hoveredIndex !== null && multipleChartLines[0]?.points[hoveredIndex] && (
                    <line 
                      x1={multipleChartLines[0].points[hoveredIndex].x}
                      y1={paddingTop}
                      x2={multipleChartLines[0].points[hoveredIndex].x}
                      y2={paddingTop + plotHeight}
                      stroke={theme === 'dark' ? '#404040' : '#d4d4d4'}
                      strokeWidth="1"
                      strokeDasharray="4 4"
                      opacity="0.8"
                    />
                  )}
                </svg>
              )}

              {/* Hover Tooltip Overlay */}
              {hoveredIndex !== null && dailyChartData[hoveredIndex] && (
                <div 
                  className={`absolute p-2.5 rounded-lg border shadow-xl flex flex-col pointer-events-none transition-all duration-100 z-10 text-[10px] min-w-[150px] ${
                    theme === 'dark' 
                      ? 'bg-neutral-950 border-neutral-850 text-neutral-200' 
                      : 'bg-white border-gray-200 text-neutral-800'
                  }`}
                  style={{
                    left: `${((multipleChartLines[0]?.points[hoveredIndex]?.x - paddingLeft) / plotWidth) * 80 + 5}%`,
                    top: `-45px`,
                  }}
                >
                  <div className="font-bold text-neutral-500 mb-1">{dailyChartData[hoveredIndex].dateStr}</div>
                  <div className="space-y-1">
                    {selectedChartMetrics.map(metric => {
                      const colors = metricColorMap[metric] || { hex: '#3b82f6', text: 'text-blue-400' };
                      const val = dailyChartData[hoveredIndex][metric] || 0;
                      return (
                        <div key={metric} className="flex items-center justify-between gap-4">
                          <span className="font-semibold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colors.hex }}></span>
                            <span>{metricLabelMap[metric]}:</span>
                          </span>
                          <span className={`font-mono font-bold ${theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>
                            {formatMetricValue(metric, val)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Table Toolbar controls */}
          <div className="flex justify-between items-center gap-2 pt-2">
            <div className="font-bold text-neutral-400 tracking-wide uppercase">소재 상세 성과 지표</div>
            
            {/* Tree nodes controls */}
            <div className="flex gap-2">
              <button 
                onClick={handleExpandAll}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-semibold transition-all cursor-pointer hover:shadow ${
                  theme === 'dark' 
                    ? 'bg-neutral-950 border-neutral-850 hover:bg-neutral-900 text-neutral-300' 
                    : 'bg-white border-gray-200 hover:bg-gray-50 text-neutral-700'
                }`}
              >
                <Maximize2 size={10} />
                <span>전체 펼치기</span>
              </button>
              
              <button 
                onClick={handleCollapseAll}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-semibold transition-all cursor-pointer hover:shadow ${
                  theme === 'dark' 
                    ? 'bg-neutral-950 border-neutral-850 hover:bg-neutral-900 text-neutral-300' 
                    : 'bg-white border-gray-200 hover:bg-gray-50 text-neutral-700'
                }`}
              >
                <Minimize2 size={10} />
                <span>전체 접기</span>
              </button>
            </div>
          </div>

          {/* Scroll-Free Compact Table */}
          <div className={`rounded-xl shadow-xl border overflow-hidden ${
            theme === 'dark' ? 'bg-neutral-950 border-neutral-850' : 'bg-white border-gray-200'
          }`}>
            <div className="w-full overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[1100px] border-collapse text-[11px]">
                <thead>
                  <tr className={`border-b text-[10px] uppercase tracking-wider font-bold ${
                    theme === 'dark' ? 'bg-neutral-950 border-neutral-850 text-neutral-500' : 'bg-gray-100 border-gray-200 text-neutral-500'
                  }`}>
                    <th className="px-3 py-3 text-left w-[24%] border-r border-neutral-900/10 whitespace-nowrap">캠페인/그룹/소재/키워드</th>
                    <th className="px-2 py-3 text-center w-[7%] border-r border-neutral-900/10 whitespace-nowrap">상태</th>
                    <SortableHeader field="imp_cnt" label="노출수" widthClass="w-[8%]" textRight />
                    <SortableHeader field="clk_cnt" label="클릭수" widthClass="w-[6%]" textRight />
                    <SortableHeader field="ctr" label="클릭률" widthClass="w-[6%]" textRight />
                    <SortableHeader field="cpc" label="평균CPC" widthClass="w-[8%]" textRight />
                    <SortableHeader field="sales_amt" label="총비용" widthClass="w-[9%]" textRight />
                    <SortableHeader field="purchase_ccnt" label="전환수" widthClass="w-[7%]" textRight />
                    <SortableHeader field="purchase_conv_amt" label="전환매출액" widthClass="w-[10%]" textRight />
                    <SortableHeader field="purchase_ror" label="ROAS" widthClass="w-[7%]" textRight />
                    <SortableHeader field="cp_conv" label="전환당비용" widthClass="w-[10%]" textRight />
                  </tr>
                </thead>
                <tbody className={`divide-y font-semibold ${
                  theme === 'dark' ? 'divide-neutral-900/60 text-neutral-300' : 'divide-gray-100 text-neutral-700'
                }`}>
                  {sortedCampaigns.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-6 py-12 text-center text-neutral-500">
                        표시할 데이터가 없습니다. {dbError && "먼저 데이터베이스를 갱신해 주세요."}
                      </td>
                    </tr>
                  ) : (
                    sortedCampaigns.map(camp => {
                      const isCampExpanded = !!expandedCampaigns[camp.ncc_campaign_id];
                      const childAdgroups = sortedAdgroups.filter(adg => adg.ncc_campaign_id === camp.ncc_campaign_id);

                      return (
                        <Fragment key={camp.ncc_campaign_id}>
                          {/* Campaign Row */}
                          <tr className={`border-b transition-colors ${
                            theme === 'dark' 
                              ? 'hover:bg-neutral-900/40 border-neutral-900 text-white font-bold' 
                              : 'hover:bg-gray-50 border-gray-100 text-neutral-900 font-bold'
                          }`}>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <button 
                                  onClick={() => toggleCampaign(camp.ncc_campaign_id)}
                                  className="p-0.5 hover:bg-neutral-800 rounded transition-colors text-neutral-500 hover:text-neutral-300 cursor-pointer flex-shrink-0"
                                >
                                  {isCampExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                </button>
                                <Megaphone size={12} className="text-blue-500 flex-shrink-0" />
                                <span className="truncate pr-1" title={camp.name}>{camp.name}</span>
                                {camp.type && (
                                  <span className={`text-[8px] px-1.5 py-0.5 rounded-md font-bold whitespace-nowrap flex-shrink-0 ml-1.5 ${
                                    camp.type === 'SHOPPING' 
                                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' 
                                      : camp.type === 'WEB' 
                                        ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                                        : camp.type === 'CONTENTS'
                                          ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                                          : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                                  }`}>
                                    {camp.type === 'SHOPPING' ? '쇼핑검색' : camp.type === 'WEB' ? '파워링크' : camp.type === 'CONTENTS' ? '파워컨텐츠' : camp.type}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-2.5 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1">
                                <span className={`w-1.5 h-1.5 rounded-full ${camp.status === 'ELIGIBLE' ? 'bg-emerald-500 shadow-[0_0_6px_#10b981]' : 'bg-neutral-500'}`}></span>
                                <span className="text-[10px] text-neutral-500">{camp.status === 'ELIGIBLE' ? '활성' : '중지'}</span>
                              </div>
                            </td>
                            <td className={`px-2 py-2.5 text-right font-mono whitespace-nowrap ${theme === 'dark' ? 'text-white font-extrabold' : 'text-neutral-900 font-extrabold'}`}>{formatMetricValue('imp_cnt', camp.imp_cnt || 0)}</td>
                            <td className={`px-2 py-2.5 text-right font-mono whitespace-nowrap ${theme === 'dark' ? 'text-white font-extrabold' : 'text-neutral-900 font-extrabold'}`}>{formatMetricValue('clk_cnt', camp.clk_cnt || 0)}</td>
                            <td className={`px-2 py-2.5 text-right font-mono whitespace-nowrap ${theme === 'dark' ? 'text-white font-extrabold' : 'text-neutral-900 font-extrabold'}`}>{formatMetricValue('ctr', camp.ctr || 0)}</td>
                            <td className={`px-2 py-2.5 text-right font-mono whitespace-nowrap ${theme === 'dark' ? 'text-white font-extrabold' : 'text-neutral-900 font-extrabold'}`}>{formatMetricValue('cpc', camp.cpc || 0)}</td>
                            <td className={`px-2 py-2.5 text-right font-mono whitespace-nowrap ${theme === 'dark' ? 'text-white font-extrabold' : 'text-neutral-900 font-extrabold'}`}>{formatMetricValue('sales_amt', camp.sales_amt || 0)}</td>
                            <td className={`px-2 py-2.5 text-right font-mono whitespace-nowrap ${theme === 'dark' ? 'text-white font-extrabold' : 'text-neutral-900 font-extrabold'}`}>{formatMetricValue('purchase_ccnt', camp.purchase_ccnt || 0)}</td>
                            <td className={`px-2 py-2.5 text-right font-mono whitespace-nowrap ${theme === 'dark' ? 'text-white font-extrabold' : 'text-neutral-900 font-extrabold'}`}>{formatMetricValue('purchase_conv_amt', camp.purchase_conv_amt || 0)}</td>
                            <td className={`px-2 py-2.5 text-right font-mono whitespace-nowrap ${theme === 'dark' ? 'text-white font-extrabold' : 'text-neutral-900 font-extrabold'}`}>{formatMetricValue('purchase_ror', camp.purchase_ror || 0)}</td>
                            <td className={`px-2 py-2.5 text-right font-mono whitespace-nowrap ${theme === 'dark' ? 'text-white font-extrabold' : 'text-neutral-900 font-extrabold'}`}>{formatMetricValue('cp_conv', camp.cp_conv || 0)}</td>
                          </tr>

                          {/* Ad Groups under Campaign */}
                          {isCampExpanded && childAdgroups.map(adg => {
                            const isAdgExpanded = !!expandedAdgroups[adg.ncc_adgroup_id];
                            const childAds = sortedAds.filter(ad => ad.ncc_adgroup_id === adg.ncc_adgroup_id);
                            const childKeywords = sortedKeywords.filter(kw => kw.ncc_adgroup_id === adg.ncc_adgroup_id);

                            return (
                              <Fragment key={adg.ncc_adgroup_id}>
                                {/* Ad Group Row */}
                                <tr className={`transition-colors ${
                                  theme === 'dark' 
                                    ? 'bg-neutral-900/10 hover:bg-neutral-900/30 text-neutral-200' 
                                    : 'bg-gray-50/40 hover:bg-gray-50/90 text-neutral-800'
                                }`}>
                                  <td className="px-3 py-2 whitespace-nowrap pl-7 relative">
                                    {/* Visual tree guide line */}
                                    <div className={`absolute left-4 top-0 bottom-0 border-l ${theme === 'dark' ? 'border-neutral-800' : 'border-gray-250'}`}></div>
                                    <div className={`absolute left-4 top-1/2 w-2 border-t ${theme === 'dark' ? 'border-neutral-800' : 'border-gray-250'}`}></div>
                                    
                                    <div className="flex items-center gap-1.5 min-w-0 pl-1.5">
                                      <button 
                                        onClick={() => toggleAdgroup(adg.ncc_adgroup_id)}
                                        className="p-0.5 hover:bg-neutral-855 rounded transition-colors text-neutral-500 hover:text-neutral-300 cursor-pointer flex-shrink-0"
                                      >
                                        {isAdgExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                      </button>
                                      <Folder size={11} className="text-amber-500/90 flex-shrink-0" />
                                      <span className="truncate pr-1" title={adg.name}>{adg.name}</span>
                                    </div>
                                  </td>
                                  <td className="px-2 py-2 text-center whitespace-nowrap">
                                    <div className="flex items-center justify-center gap-1">
                                      <span className={`w-1.5 h-1.5 rounded-full ${adg.status === 'ELIGIBLE' ? 'bg-emerald-500/80 shadow-[0_0_4px_#10b981]' : 'bg-neutral-600'}`}></span>
                                      <span className="text-[10px] text-neutral-500">{adg.status === 'ELIGIBLE' ? '활성' : '중지'}</span>
                                    </div>
                                  </td>
                                  <td className="px-2 py-2 text-right font-mono font-extrabold whitespace-nowrap">{formatMetricValue('imp_cnt', adg.imp_cnt || 0)}</td>
                                  <td className="px-2 py-2 text-right font-mono font-extrabold whitespace-nowrap">{formatMetricValue('clk_cnt', adg.clk_cnt || 0)}</td>
                                  <td className="px-2 py-2 text-right font-mono font-extrabold whitespace-nowrap">{formatMetricValue('ctr', adg.ctr || 0)}</td>
                                  <td className="px-2 py-2 text-right font-mono font-extrabold whitespace-nowrap">{formatMetricValue('cpc', adg.cpc || 0)}</td>
                                  <td className="px-2 py-2 text-right font-mono font-extrabold whitespace-nowrap">{formatMetricValue('sales_amt', adg.sales_amt || 0)}</td>
                                  <td className="px-2 py-2 text-right font-mono font-extrabold whitespace-nowrap">{formatMetricValue('purchase_ccnt', adg.purchase_ccnt || 0)}</td>
                                  <td className="px-2 py-2 text-right font-mono font-extrabold whitespace-nowrap">{formatMetricValue('purchase_conv_amt', adg.purchase_conv_amt || 0)}</td>
                                  <td className="px-2 py-2 text-right font-mono font-extrabold whitespace-nowrap">{formatMetricValue('purchase_ror', adg.purchase_ror || 0)}</td>
                                  <td className="px-2 py-2 text-right font-mono font-extrabold whitespace-nowrap">{formatMetricValue('cp_conv', adg.cp_conv || 0)}</td>
                                </tr>

                                {/* Ads (Creatives) under Ad Group */}
                                {isAdgExpanded && childAds.map(ad => {
                                  const isAdExpanded = !!expandedAds[ad.ncc_ad_id];
                                  const childQueries = sortedShoppingQueries.filter(q => q.ncc_ad_id === ad.ncc_ad_id);

                                  return (
                                    <Fragment key={ad.ncc_ad_id}>
                                      <tr className={`transition-colors text-[10px] ${
                                        theme === 'dark' 
                                          ? 'bg-neutral-950/20 hover:bg-neutral-900/10 text-neutral-450' 
                                          : 'bg-gray-100/20 hover:bg-gray-100/50 text-neutral-500'
                                      }`}>
                                        <td className="px-3 py-1.5 whitespace-nowrap pl-11 relative">
                                          {/* Visual tree guide line double nesting */}
                                          <div className={`absolute left-4 top-0 bottom-0 border-l ${theme === 'dark' ? 'border-neutral-800' : 'border-gray-250'}`}></div>
                                          <div className={`absolute left-8 top-0 bottom-0 border-l ${theme === 'dark' ? 'border-neutral-800' : 'border-gray-250'}`}></div>
                                          <div className={`absolute left-8 top-1/2 w-2 border-t ${theme === 'dark' ? 'border-neutral-800' : 'border-gray-250'}`}></div>

                                          <div className="flex items-center gap-1.5 min-w-0 pl-1.5">
                                            {childQueries.length > 0 && (
                                              <button 
                                                onClick={() => toggleAd(ad.ncc_ad_id)}
                                                className="p-0.5 hover:bg-neutral-855 rounded transition-colors text-neutral-500 hover:text-neutral-300 cursor-pointer flex-shrink-0"
                                              >
                                                {isAdExpanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                                              </button>
                                            )}
                                            {ad.image_url ? (
                                              <img 
                                                src={ad.image_url} 
                                                alt={ad.name} 
                                                className="w-5 h-5 object-cover rounded border border-neutral-800 flex-shrink-0 bg-neutral-900"
                                                onError={(e) => {
                                                  (e.target as HTMLElement).style.display = 'none';
                                                }}
                                              />
                                            ) : (
                                              <Tag size={9} className="text-neutral-600 flex-shrink-0" />
                                            )}
                                            <span className="truncate pr-1" title={ad.name}>{ad.name}</span>
                                          </div>
                                        </td>
                                        <td className="px-2 py-1.5 text-center whitespace-nowrap">
                                          <div className="flex items-center justify-center gap-1">
                                            <span className={`w-1 h-1 rounded-full ${ad.status === 'ELIGIBLE' ? 'bg-emerald-500/60' : 'bg-neutral-700'}`}></span>
                                            <span className="text-[9px] text-neutral-500">{ad.status === 'ELIGIBLE' ? '활성' : '중지'}</span>
                                          </div>
                                        </td>
                                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('imp_cnt', ad.imp_cnt || 0)}</td>
                                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('clk_cnt', ad.clk_cnt || 0)}</td>
                                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('ctr', ad.ctr || 0)}</td>
                                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('cpc', ad.cpc || 0)}</td>
                                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('sales_amt', ad.sales_amt || 0)}</td>
                                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('purchase_ccnt', ad.purchase_ccnt || 0)}</td>
                                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('purchase_conv_amt', ad.purchase_conv_amt || 0)}</td>
                                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('purchase_ror', ad.purchase_ror || 0)}</td>
                                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('cp_conv', ad.cp_conv || 0)}</td>
                                      </tr>

                                      {/* Search Queries under Ad/Creative */}
                                      {isAdExpanded && childQueries.map(q => (
                                        <tr key={`${q.ncc_ad_id}-${q.query}`} className={`transition-colors text-[9px] ${
                                          theme === 'dark' 
                                            ? 'bg-neutral-950/40 hover:bg-neutral-900/20 text-neutral-500' 
                                            : 'bg-gray-150/20 hover:bg-gray-150/50 text-neutral-500'
                                        }`}>
                                          <td className="px-3 py-1.5 whitespace-nowrap pl-15 relative">
                                            {/* Visual tree guide line triple nesting */}
                                            <div className={`absolute left-4 top-0 bottom-0 border-l ${theme === 'dark' ? 'border-neutral-800' : 'border-gray-250'}`}></div>
                                            <div className={`absolute left-8 top-0 bottom-0 border-l ${theme === 'dark' ? 'border-neutral-800' : 'border-gray-250'}`}></div>
                                            <div className={`absolute left-12 top-0 bottom-0 border-l ${theme === 'dark' ? 'border-neutral-800' : 'border-gray-250'}`}></div>
                                            <div className={`absolute left-12 top-1/2 w-2 border-t ${theme === 'dark' ? 'border-neutral-800' : 'border-gray-250'}`}></div>

                                            <div className="flex items-center gap-1.5 min-w-0 pl-1">
                                              <Search size={8} className="text-emerald-500 flex-shrink-0" />
                                              <span className="truncate pr-1 text-emerald-500 font-semibold" title={q.query}>{q.query}</span>
                                              <span className={`text-[6px] px-1 rounded flex-shrink-0 ${theme === 'dark' ? 'bg-neutral-900 text-neutral-500' : 'bg-gray-200 text-neutral-600'}`}>검색어</span>
                                            </div>
                                          </td>
                                          <td className="px-2 py-1.5 text-center whitespace-nowrap text-neutral-650">-</td>
                                          <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('imp_cnt', q.imp_cnt || 0)}</td>
                                          <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('clk_cnt', q.clk_cnt || 0)}</td>
                                          <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('ctr', q.ctr || 0)}</td>
                                          <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('cpc', q.cpc || 0)}</td>
                                          <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('sales_amt', q.sales_amt || 0)}</td>
                                          <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('purchase_ccnt', q.purchase_ccnt || 0)}</td>
                                          <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('purchase_conv_amt', q.purchase_conv_amt || 0)}</td>
                                          <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('purchase_ror', q.purchase_ror || 0)}</td>
                                          <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('cp_conv', q.cp_conv || 0)}</td>
                                        </tr>
                                      ))}
                                    </Fragment>
                                  );
                                })}

                                {/* Keywords under Ad Group */}
                                {isAdgExpanded && childKeywords.map(kw => (
                                  <tr key={kw.ncc_keyword_id} className={`transition-colors text-[10px] ${
                                    theme === 'dark' 
                                      ? 'bg-neutral-950/20 hover:bg-neutral-900/10 text-neutral-450' 
                                      : 'bg-gray-100/20 hover:bg-gray-100/50 text-neutral-500'
                                  }`}>
                                    <td className="px-3 py-1.5 whitespace-nowrap pl-11 relative">
                                      {/* Visual tree guide line double nesting */}
                                      <div className={`absolute left-4 top-0 bottom-0 border-l ${theme === 'dark' ? 'border-neutral-800' : 'border-gray-250'}`}></div>
                                      <div className={`absolute left-8 top-0 bottom-0 border-l ${theme === 'dark' ? 'border-neutral-800' : 'border-gray-250'}`}></div>
                                      <div className={`absolute left-8 top-1/2 w-2 border-t ${theme === 'dark' ? 'border-neutral-800' : 'border-gray-250'}`}></div>

                                      <div className="flex items-center gap-1.5 min-w-0 pl-1.5">
                                        <Search size={9} className="text-blue-500 flex-shrink-0" />
                                        <span className="truncate pr-1 text-blue-500 font-semibold" title={kw.keyword}>{kw.keyword}</span>
                                        <span className={`text-[7px] px-1 rounded flex-shrink-0 ${theme === 'dark' ? 'bg-neutral-800 text-neutral-400' : 'bg-gray-200 text-neutral-600'}`}>키워드</span>
                                      </div>
                                    </td>
                                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                                      <div className="flex items-center justify-center gap-1">
                                        <span className={`w-1 h-1 rounded-full ${kw.status === 'ELIGIBLE' ? 'bg-emerald-500/60' : 'bg-neutral-700'}`}></span>
                                        <span className="text-[9px] text-neutral-500">{kw.status === 'ELIGIBLE' ? '활성' : '중지'}</span>
                                      </div>
                                    </td>
                                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('imp_cnt', kw.imp_cnt || 0)}</td>
                                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('clk_cnt', kw.clk_cnt || 0)}</td>
                                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('ctr', kw.ctr || 0)}</td>
                                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('cpc', kw.cpc || 0)}</td>
                                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('sales_amt', kw.sales_amt || 0)}</td>
                                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('purchase_ccnt', kw.purchase_ccnt || 0)}</td>
                                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('purchase_conv_amt', kw.purchase_conv_amt || 0)}</td>
                                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('purchase_ror', kw.purchase_ror || 0)}</td>
                                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatMetricValue('cp_conv', kw.cp_conv || 0)}</td>
                                  </tr>
                                ))}
                              </Fragment>
                            );
                          })}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          </>
          )}
        </div>
      </div>

      {/* Settings Modal Overlay */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className={`w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] ${
            theme === 'dark' ? 'bg-neutral-950 border-neutral-850 text-neutral-100' : 'bg-white border-gray-200 text-neutral-800'
          }`}>
            {/* Modal Header */}
            <div className={`px-6 py-4 border-b flex items-center justify-between ${
              theme === 'dark' ? 'border-neutral-900 bg-neutral-950' : 'border-gray-150 bg-gray-50'
            }`}>
              <div className="flex items-center gap-2">
                <Settings size={16} className="text-blue-500" />
                <h3 className="text-sm font-bold">대시보드 및 사용자 설정</h3>
              </div>
              <button 
                onClick={() => setShowSettingsModal(false)}
                className="text-neutral-500 hover:text-neutral-300 text-sm font-semibold cursor-pointer"
              >
                닫기
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar text-xs">
              
              {/* User Self Info */}
              <div className="space-y-4">
                <h4 className="font-bold text-[11px] text-neutral-400 uppercase tracking-wider">내 계정 정보 및 네이버 API 연동 키 수정</h4>
                <div className={`p-4 rounded-xl border space-y-4 ${
                  theme === 'dark' ? 'bg-neutral-900/40 border-neutral-900' : 'bg-gray-50/50 border-gray-150'
                }`}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-neutral-400 text-[10px]">이메일 주소</span>
                      <span className="font-semibold">{userProfile?.email}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-neutral-400 text-[10px]">계정 역할</span>
                      <span className="font-semibold uppercase text-blue-500">
                        {userProfile?.role === 'admin' 
                          ? '관리자 (Admin)' 
                          : userProfile?.role === 'pending'
                            ? '승인 대기 (Pending)'
                            : '일반 담당자 (Manager)'}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-neutral-400 text-[10px]">네이버 담당 번호 (매니저ID)</span>
                      <span className="font-mono font-semibold">
                        {userProfile?.manager_account_no 
                          ? `${userProfile.manager_account_no} (${dynamicManagers[userProfile.manager_account_no] || '지정'})`
                          : '미지정 (전체 데이터 노출)'}
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-neutral-900/40 my-3 pt-3 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-neutral-400 text-[10px] font-bold">네이버 API Key</label>
                        <input
                          type="text"
                          value={ownApiKey}
                          onChange={(e) => setOwnApiKey(e.target.value)}
                          placeholder="0100000000..."
                          className="px-2.5 py-1.5 rounded-lg border bg-neutral-900 text-neutral-200 border-neutral-800 text-[10px] outline-none"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-neutral-400 text-[10px] font-bold">네이버 Secret Key</label>
                        <input
                          type="password"
                          value={ownSecretKey}
                          onChange={(e) => setOwnSecretKey(e.target.value)}
                          placeholder="AQAAAAB..."
                          className="px-2.5 py-1.5 rounded-lg border bg-neutral-900 text-neutral-200 border-neutral-800 text-[10px] outline-none"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-neutral-400 text-[10px] font-bold">네이버 고객 ID (Customer ID)</label>
                        <input
                          type="text"
                          value={ownCustomerId}
                          onChange={(e) => setOwnCustomerId(e.target.value)}
                          placeholder="고객 ID 입력"
                          className="px-2.5 py-1.5 rounded-lg border bg-neutral-900 text-neutral-200 border-neutral-800 text-[10px] outline-none font-mono"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        onClick={handleUpdateOwnApiKeys}
                        disabled={savingOwnKeys}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-bold rounded-lg text-[10px] shadow transition-all cursor-pointer"
                      >
                        {savingOwnKeys ? '저장 중...' : '네이버 API 정보 저장'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Admin User Management */}
              {userProfile?.role === 'admin' && (
                <div className="space-y-3 pt-2">
                  <h4 className="font-bold text-[11px] text-neutral-400 uppercase tracking-wider flex items-center justify-between">
                    <span>전체 가입자 권한 및 광고주 담당자 매핑 (관리자 전용)</span>
                    <span className="text-[9px] text-neutral-500 font-normal normal-case">가입된 모든 사용자 목록</span>
                  </h4>
                  
                  <div className={`border rounded-xl overflow-hidden ${
                    theme === 'dark' ? 'border-neutral-900' : 'border-gray-250'
                  }`}>
                    <table className="w-full text-left border-collapse text-[10px]">
                      <thead>
                        <tr className={theme === 'dark' ? 'bg-neutral-900 text-neutral-400' : 'bg-gray-50 text-neutral-600'}>
                          <th className="p-2.5">사용자 이메일</th>
                          <th className="p-2.5 w-[20%]">역할</th>
                          <th className="p-2.5 w-[35%]">네이버 광고 담당자 매핑</th>
                          <th className="p-2.5 w-[15%] text-right">관리</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-900/40">
                        {profilesList.map(u => {
                          const isOwnProfile = u.id === userProfile.id;
                          return (
                            <UserRow 
                              key={u.id}
                              user={u}
                              theme={theme}
                              isOwnProfile={isOwnProfile}
                              managerFallbackMap={dynamicManagers}
                              onSave={handleUpdateProfile}
                            />
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ 
  metric, 
  value, 
  icon, 
  theme, 
  onMetricChange, 
  metricLabelMap 
}: { 
  metric: string, 
  value: string | number, 
  icon: React.ReactNode, 
  theme: 'light' | 'dark', 
  onMetricChange: (m: string) => void, 
  metricLabelMap: Record<string, string> 
}) {
  return (
    <div className={`p-4 rounded-xl border flex items-center gap-4 transition-all hover:-translate-y-0.5 hover:shadow-lg duration-300 ${
      theme === 'dark' 
        ? 'bg-neutral-950 border-neutral-800 hover:border-neutral-700 text-white' 
        : 'bg-white border-gray-200 hover:border-gray-300 text-neutral-800'
    }`}>
      <div className={`p-2.5 rounded-lg shadow-inner flex-shrink-0 ${
        theme === 'dark' ? 'bg-neutral-900 border border-neutral-850' : 'bg-gray-50 border border-gray-150'
      }`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 mb-0.5">
          <select
            value={metric}
            onChange={(e) => onMetricChange(e.target.value)}
            className={`text-[9px] font-extrabold uppercase tracking-wider bg-transparent border-none outline-none focus:ring-0 p-0 pr-4 cursor-pointer truncate max-w-full font-sans ${
              theme === 'dark' 
                ? 'text-neutral-400 hover:text-white [color-scheme:dark]' 
                : 'text-neutral-500 hover:text-neutral-900'
            }`}
          >
            {Object.entries(metricLabelMap).map(([key, label]) => (
              <option key={key} value={key} className={theme === 'dark' ? 'bg-neutral-900 text-neutral-200' : 'bg-white text-neutral-800'}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <p className={`text-base font-extrabold tracking-tight font-mono truncate ${
          theme === 'dark' ? 'text-white' : 'text-neutral-900'
        }`}>{value}</p>
      </div>
    </div>
  );
}

function UserRow({ 
  user, 
  theme, 
  isOwnProfile, 
  managerFallbackMap, 
  onSave 
}: { 
  user: any, 
  theme: 'light' | 'dark', 
  isOwnProfile: boolean, 
  managerFallbackMap: Record<number | string, string>, 
  onSave: (id: string, role: string, managerNo: number | string) => void 
}) {
  const [role, setRole] = useState(user.role || 'pending');
  const [managerNo, setManagerNo] = useState<number | string>(user.manager_account_no || 'none');

  const hasChanged = role !== (user.role || 'pending') || managerNo !== (user.manager_account_no || 'none');

  return (
    <tr className={theme === 'dark' ? 'hover:bg-neutral-900/30' : 'hover:bg-gray-50/50'}>
      <td className="p-2.5 font-semibold">
        {user.email} {isOwnProfile && <span className="text-[8.5px] text-blue-500 ml-1 font-bold">(나)</span>}
      </td>
      <td className="p-2.5">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          disabled={isOwnProfile}
          className={`px-1.5 py-1 rounded border bg-transparent text-[10px] outline-none ${
            theme === 'dark' ? 'border-neutral-800 text-neutral-200 [color-scheme:dark]' : 'border-gray-200 text-neutral-800'
          }`}
        >
          <option value="pending">승인 대기 (Pending)</option>
          <option value="manager">일반 (Manager)</option>
          <option value="admin">관리자 (Admin)</option>
        </select>
      </td>
      <td className="p-2.5">
        <select
          value={managerNo}
          onChange={(e) => setManagerNo(e.target.value)}
          className={`w-full px-1.5 py-1 rounded border bg-transparent text-[10px] outline-none ${
            theme === 'dark' ? 'border-neutral-800 text-neutral-200 [color-scheme:dark]' : 'border-gray-200 text-neutral-800'
          }`}
        >
          <option value="none">미지정 (전체 데이터 노출)</option>
          {Object.entries(managerFallbackMap).map(([no, name]) => (
            <option key={no} value={no}>
              {no} - {name}
            </option>
          ))}
        </select>
      </td>
      <td className="p-2.5 text-right">
        <button
          onClick={() => onSave(user.id, role, managerNo)}
          disabled={!hasChanged}
          className={`px-2 py-1 rounded font-bold text-[9px] transition-all cursor-pointer ${
            hasChanged 
              ? 'bg-blue-600 hover:bg-blue-500 text-white' 
              : theme === 'dark' 
                ? 'bg-neutral-900 text-neutral-600 cursor-not-allowed border border-transparent' 
                : 'bg-gray-100 text-gray-400 cursor-not-allowed border border-transparent'
          }`}
        >
          저장
        </button>
      </td>
    </tr>
  );
}
