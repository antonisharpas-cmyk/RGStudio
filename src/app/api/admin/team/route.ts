import { NextResponse } from "next/server";
import { body, owner } from "@/lib/api-guard";
import { addTeamMember, listTeam, updateTeamMember } from "@/lib/team";

/**
 * The team, from the desk. The owner's alone: who teaches here is the studio's
 * business, not reception's, and every route here refuses reception rather
 * than merely hiding the tab.
 *
 * DELETE switches somebody off rather than deleting the row: past classes keep
 * their name. PATCH with `active: true` puts them back.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await owner();
  if ("res" in gate) return gate.res;
  return NextResponse.json({ team: listTeam() });
}

type Payload = {
  id?: string;
  name?: string;
  bioEn?: string;
  bioEl?: string;
  bioRu?: string;
  photoUrl?: string | null;
  active?: boolean;
  sortOrder?: number;
};

export async function POST(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;
  const data = await body<Payload>(req);
  if (!data) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });

  const result = addTeamMember(data);
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: 400 });
  return NextResponse.json({ ok: true, member: result.member, team: listTeam() });
}

export async function PATCH(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;
  const data = await body<Payload>(req);
  if (!data?.id) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });

  const { id, ...patch } = data;
  const result = updateTeamMember(id, patch);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.code },
      { status: result.code === "NOT_FOUND" ? 404 : 400 },
    );
  }
  return NextResponse.json({ ok: true, member: result.member, team: listTeam() });
}

export async function DELETE(req: Request) {
  const gate = await owner();
  if ("res" in gate) return gate.res;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });

  const result = updateTeamMember(id, { active: false });
  if (!result.ok) return NextResponse.json({ error: result.code }, { status: 404 });
  return NextResponse.json({ ok: true, team: listTeam() });
}
