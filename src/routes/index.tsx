import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Imobiliária Studio IA — Virtual staging e vídeo" },
      { name: "description", content: "Decore imóveis vazios com IA e gere vídeos de antes e depois." },
      { property: "og:title", content: "Imobiliária Studio IA" },
      { property: "og:description", content: "Decore imóveis vazios com IA e gere vídeos de antes e depois." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <p className="eyebrow">Estúdio criativo / virtual staging</p>
      <h1 className="mt-3 font-display text-4xl">Transforme imóveis em experiências.</h1>
      <div className="panel mt-8 text-sm text-muted-foreground">
        Em construção: a base segura do estúdio já está pronta, mas a tela de criação ainda não foi concluída.
      </div>
    </main>
  );
}
