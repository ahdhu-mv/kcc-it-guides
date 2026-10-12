import { notFound } from "next/navigation";
import { ErrorView } from "@/components/ErrorView";
import { GuideEditor } from "@/components/GuideEditor";
import { ValidationError } from "@/lib/errors";
import * as guides from "@/lib/guides";
import { guard } from "@/lib/page";
import { getCategory } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EditGuide({ params }: { params: Promise<{ slug: string; guide: string }> }) {
  const { slug, guide } = await params;
  return guard(`/c/${slug}/g/${guide}/edit`, async ({ svc, session }) => {
    const found = await svc.repo.read((root) => {
      const cat = getCategory(svc, session.user, root, slug);
      try {
        return { cat, file: guides.readGuide(root, slug, guide) };
      } catch (err) {
        if (err instanceof ValidationError) return { cat, file: null };
        throw err;
      }
    });
    if (!found.file) notFound();
    const f = found.file;
    return <GuideEditor category={{ slug: found.cat.slug, name: found.cat.name }} mode="edit"
      initial={{ title: f.title, description: f.description, slug: guide, body: f.body.replace(/^\n+/, ""), baseHash: f.hash }} />;
  }, (e) => <ErrorView error={e} />);
}
