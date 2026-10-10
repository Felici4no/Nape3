import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { docBySlug, docs, graph, neighbours, plainTitle, REPO_TREE } from "@/lib/docs";
import { Graph } from "../_vault/Graph";
import { Icon } from "../_vault/icons";
import styles from "../_vault/vault.module.css";

export const dynamicParams = false;

export function generateStaticParams() {
  return docs.map((d) => ({ slug: d.slug.split("/") }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const doc = docBySlug((await params).slug.join("/"));
  return doc ? { title: plainTitle(doc.title), description: doc.summary } : {};
}

const KIND_LABEL: Record<string, string> = { incident: "incident", spike: "spike", proof: "proof", decision: "decision", app: "app", note: "note" };

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const slug = (await params).slug.join("/");
  const doc = docBySlug(slug);
  if (!doc) notFound();
  const i = docs.indexOf(doc);
  const prev = docs[i - 1];
  const next = docs[i + 1];
  // the note's own H1 becomes the inline title above the properties
  const body = doc.html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\n?/, "");
  const near = neighbours(slug);
  const titleOf = (s: string) => plainTitle(docBySlug(s)?.title ?? s);
  // local graph: this note in the middle, its neighbours on a ring (direct links first, then the folder)
  const direct = (s: string) => doc.links.includes(s) || doc.backlinks.includes(s);
  const ring = [...near]
    .filter((s) => s !== slug)
    .sort((a, b) => Number(direct(b)) - Number(direct(a)))
    .slice(0, 12);
  const localNodes = [
    { slug, group: doc.group, x: 0.5, y: 0.5, title: titleOf(slug) },
    ...ring.map((s, k) => {
      const a = (k / Math.max(ring.length, 1)) * Math.PI * 2 - Math.PI / 2;
      return { slug: s, group: docBySlug(s)?.group ?? "", x: 0.5 + Math.cos(a) * 0.5, y: 0.5 + Math.sin(a) * 0.5, title: titleOf(s) };
    })
  ];
  const localEdges = graph.edges.filter(([a, b]) => near.has(a) && near.has(b));
  const crumbs = doc.source.replace(/^docs\//, "").replace(/\.md$/, "").split("/");
  const minutes = Math.max(1, Math.round(doc.words / 220));

  return (
    <div className={styles.leaf}>
      <div className={styles.note}>
        <div className={styles.viewHeader}>
          <div className={styles.crumbs}>
            {crumbs.map((c, k) => (
              <span key={k}>
                {k > 0 && <i>/</i>}
                {k === crumbs.length - 1 ? <strong>{c}</strong> : c}
              </span>
            ))}
          </div>
          <a className={styles.iconBtn} href={`${REPO_TREE}/${doc.source}`} target="_blank" rel="noreferrer" title="Open source file on GitHub" aria-label="Open source file on GitHub">
            <Icon name="external" size={15} />
          </a>
        </div>

        <div className={styles.page}>
          <h1 className={styles.inlineTitle}>{plainTitle(doc.title)}</h1>

          <dl className={styles.props}>
            <div>
              <dt><Icon name="tag" size={14} /> tags</dt>
              <dd>
                <span className={styles.tagPill}>#{KIND_LABEL[doc.kind] ?? doc.kind}</span>
                {doc.group && <span className={styles.tagPill}>#{doc.group.replace(/^\d+-/, "")}</span>}
              </dd>
            </div>
            {doc.date && (
              <div>
                <dt><Icon name="calendar" size={14} /> date</dt>
                <dd>{doc.date}</dd>
              </div>
            )}
            <div>
              <dt><Icon name="clock" size={14} /> reading</dt>
              <dd>{minutes} min · {doc.words.toLocaleString("en-US")} words</dd>
            </div>
            <div>
              <dt><Icon name="file" size={14} /> source</dt>
              <dd>
                <a href={`${REPO_TREE}/${doc.source}`} target="_blank" rel="noreferrer">{doc.source}</a>
              </dd>
            </div>
            <div>
              <dt><Icon name="link" size={14} /> links</dt>
              <dd>{doc.links.length} out · {doc.backlinks.length} in</dd>
            </div>
          </dl>

          <div className={styles.prose} dangerouslySetInnerHTML={{ __html: body }} />

          <section className={styles.mentions} aria-label="Linked mentions">
            <h2>
              <Icon name="link" size={15} /> Linked mentions <span>{doc.backlinks.length}</span>
            </h2>
            {doc.backlinks.length ? (
              <ul>
                {doc.backlinks.map((b) => {
                  const d = docBySlug(b);
                  return (
                    <li key={b}>
                      <Link href={`/docs/${b}`}>
                        <strong>{titleOf(b)}</strong>
                        <span>{d?.summary}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>No other note links here yet.</p>
            )}
          </section>

          <nav className={styles.pager} aria-label="Previous and next note">
            {prev ? (
              <Link href={`/docs/${prev.slug}`}>
                <span>← Previous</span>
                {plainTitle(prev.title)}
              </Link>
            ) : (
              <i />
            )}
            {next && (
              <Link className={styles.next} href={`/docs/${next.slug}`}>
                <span>Next →</span>
                {plainTitle(next.title)}
              </Link>
            )}
          </nav>
        </div>
      </div>

      <aside className={styles.right} aria-label="Outline and local graph">
        <div className={styles.paneHead}><span>Local graph</span></div>
        <div className={styles.localGraph}>
          <Graph nodes={localNodes} edges={localEdges} current={slug} aspect={0.9} labels={ring.length > 7 ? "hover" : "all"} width={300} />
        </div>
        {doc.toc.length > 0 && (
          <>
            <div className={styles.paneHead}><span>Outline</span></div>
            <nav className={styles.outline}>
              {doc.toc.map((t) => (
                <a key={t.id} href={`#${t.id}`} className={t.depth === 3 ? styles.sub : undefined}>
                  {t.text}
                </a>
              ))}
            </nav>
          </>
        )}
      </aside>
    </div>
  );
}
