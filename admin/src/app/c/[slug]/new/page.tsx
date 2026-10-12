import { ErrorView } from "@/components/ErrorView";
import { GuideEditor } from "@/components/GuideEditor";
import { guard } from "@/lib/page";
import { getCategory } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewGuide({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return guard(`/c/${slug}/new`, async ({ svc, session }) => {
    const cat = await svc.repo.read((root) => getCategory(svc, session.user, root, slug));
    return <GuideEditor category={{ slug: cat.slug, name: cat.name }} mode="new"
      initial={{ title: "", description: "", slug: "", body: "", baseHash: "" }} />;
  }, (e) => <ErrorView error={e} />);
}
