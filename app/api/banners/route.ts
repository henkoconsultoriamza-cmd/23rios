import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const revalidate = 30;

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data } = await supabase
    .from("restaurant_config")
    .select("value")
    .eq("key", "banners")
    .single();
  return NextResponse.json(data?.value ?? [], {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
  });
}
