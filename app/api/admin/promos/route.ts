/**
 * POST /api/admin/promos — guarda una promoción a la vez sobre la versión más reciente.
 *   { op: "create", promo } · { op: "patch", id, fields } · { op: "delete", id }
 * Responde { promos } con la lista ya guardada.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/admin-auth";
import { applyFields, readConfig, writeConfig } from "@/lib/restaurant-config";
import type { Promo } from "@/app/menu-data";

type Body =
  | { op: "create"; promo: Promo }
  | { op: "patch"; id: string; fields: Record<string, unknown> }
  | { op: "delete"; id: string };

export async function POST(req: NextRequest) {
  if (!(await verifyAdminSession())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || !("op" in body)) {
    return NextResponse.json({ error: "Pedido inválido" }, { status: 400 });
  }

  try {
    const promos = (await readConfig<Promo[]>("promos")) ?? [];
    let next: Promo[];

    if (body.op === "create") {
      next = promos.some((p) => p.id === body.promo.id) ? promos : [...promos, body.promo];
    } else if (body.op === "patch") {
      const current = promos.find((p) => p.id === body.id);
      if (!current) {
        return NextResponse.json({ error: "Esa promoción ya no existe: la borraron desde otra pestaña." }, { status: 404 });
      }
      next = promos.map((p) => (p.id === body.id ? applyFields(current, body.fields ?? {}) : p));
    } else if (body.op === "delete") {
      next = promos.filter((p) => p.id !== body.id);
    } else {
      return NextResponse.json({ error: "Operación desconocida" }, { status: 400 });
    }

    await writeConfig("promos", next);
    return NextResponse.json({ promos: next });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
