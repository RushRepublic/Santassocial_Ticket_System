import { Application } from "@/components/application";
import { MetaPixelFallback } from "@/components/meta-pixel";
export default async function Page({ params, searchParams }) {
  const { path } = await params;
  const publicCheckout = path.length === 1 && path[0] === "checkout" &&
    !Object.keys(await searchParams).length;
  return <><Application />{publicCheckout && <MetaPixelFallback />}</>;
}
