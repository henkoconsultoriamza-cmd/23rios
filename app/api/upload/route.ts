import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  // Solo el admin autenticado puede subir imágenes
  const authorized = await verifyAdminSession();
  if (!authorized) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const folder = (form.get("folder") as string) || "misc";

    if (!file) return NextResponse.json({ error: "No se recibió ningún archivo." }, { status: 400 });
    if (file.size > 3_000_000) return NextResponse.json({ error: "La imagen debe pesar menos de 3 MB." }, { status: 400 });
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Tipo de archivo no permitido." }, { status: 400 });
    }

    // Sanitizar nombre de carpeta para evitar path traversal
    const safeFolder = folder.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50) || "misc";
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${safeFolder}/${Date.now()}.${ext}`;
    const bytes = await file.arrayBuffer();

    const { error } = await supabaseAdmin.storage
      .from("menu-images")
      .upload(path, bytes, { upsert: true, contentType: file.type });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data } = supabaseAdmin.storage.from("menu-images").getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl });
  } catch {
    return NextResponse.json({ error: "Error al procesar la imagen." }, { status: 500 });
  }
}
