import { supabase } from "./supabaseClient";
import { User } from "../types";

/**
 * Map 1 dòng public.profiles (+ households.invite_code nếu có) sang đúng
 * shape User đang được App.tsx và các component khác dùng — để T-S04 chỉ
 * đổi phần vận chuyển xác thực (Supabase Auth), không đụng vào tầng dữ liệu
 * localStorage/household hiện có (đó là phạm vi T-S05/T-S06).
 */
export async function buildUserFromProfile(userId: string): Promise<User | null> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select(
      "id, email, name, personal_role, household_id, telegram_chat_id, telegram_username, telegram_link_token"
    )
    .eq("id", userId)
    .single();

  if (error || !profile) return null;

  let householdInviteCode: string | undefined;
  if (profile.household_id) {
    const { data: hh } = await supabase
      .from("households")
      .select("invite_code")
      .eq("id", profile.household_id)
      .single();
    householdInviteCode = hh?.invite_code ?? undefined;
  }

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.personal_role,
    displayName: `${profile.personal_role} (${profile.name})`,
    linkToken: profile.telegram_link_token || "",
    telegramChatId: profile.telegram_chat_id ?? undefined,
    telegramUsername: profile.telegram_username ?? undefined,
    householdInviteCode,
  };
}

/** Đọc session hiện có (nếu có) và dựng User tương ứng — dùng để khôi phục
 * đăng nhập sau khi refresh trang (acceptance criteria T-S04). */
export async function getUserFromCurrentSession(): Promise<User | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return null;
  return buildUserFromProfile(session.user.id);
}
