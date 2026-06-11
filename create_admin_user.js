const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env variables from .env.local
const envPath = path.join(__dirname, '.env.local');
const config = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  content.split(/\r?\n/).forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      config[key] = value;
    }
  });
}

const supabaseUrl = config.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = config.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function main() {
  const email = 'w00ki_@mymp.co.kr';
  const password = '88141682!@#';

  console.log(`Creating Admin user: ${email}...`);

  // 1. Create the user in Auth
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('already been registered') || msg.includes('registered')) {
      console.log('User already exists in Auth. Proceeding to update role...');
    } else {
      console.error('Failed to create user:', error.message);
      return;
    }
  } else {
    console.log('User successfully created in Auth!');
  }

  // 2. Get the user ID
  let userId;
  if (data && data.user) {
    userId = data.user.id;
  } else {
    const { data: listData, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) {
      console.error('Failed to list users:', listError.message);
      return;
    }
    const foundUser = listData.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!foundUser) {
      console.error('User not found in Auth even after checking list.');
      return;
    }
    userId = foundUser.id;
  }

  console.log(`User ID: ${userId}`);

  // 3. Upsert the user profile
  const { error: profileError } = await supabase
    .from('user_profiles')
    .upsert({
      id: userId,
      email,
      role: 'admin'
    });

  if (profileError) {
    console.error('Failed to update user profile:', profileError.message);
    console.log('Attempting simple update...');
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ role: 'admin' })
      .eq('id', userId);
    if (updateError) {
      console.error('Update failed as well:', updateError.message);
    } else {
      console.log('User profile role updated to admin via UPDATE!');
    }
  } else {
    console.log('User profile updated successfully with role: admin');
  }
}

main();
