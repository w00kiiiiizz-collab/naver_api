import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: '인증 토큰이 누락되었습니다.' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    // Get user from auth token
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: '유효하지 않은 토큰입니다.' }, { status: 401 });
    }

    // Verify if the logged-in user is an admin in user_profiles
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || profile.role !== 'admin') {
      return NextResponse.json({ error: '권한이 없습니다. 관리자만 접근 가능합니다.' }, { status: 403 });
    }

    // Parse the body
    const body = await request.json();
    const { userId, role, managerAccountNo } = body;

    if (!userId || !role) {
      return NextResponse.json({ error: 'userId와 role은 필수 입력 항목입니다.' }, { status: 400 });
    }

    const managerNoVal = managerAccountNo === '' || managerAccountNo === 'none' || managerAccountNo === null ? null : parseInt(managerAccountNo.toString(), 10);

    // Update profile using supabaseAdmin which bypasses RLS
    const { error: updateError } = await supabaseAdmin
      .from('user_profiles')
      .update({ 
        role, 
        manager_account_no: managerNoVal 
      })
      .eq('id', userId);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Admin Update User Profile API Error]:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
