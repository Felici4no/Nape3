import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { docBySlug, docs, plainTitle, REPO_TREE } from "@/lib/docs";
import styles from "../docs.module.css";

export const dynamicParams = false;

export function generateStaticParams() {
  return docs.map((d) => ({ slug: d.slug.split("/") }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }): Promise<Metadata> {
  const doc = docBySlug((await params).slug.join("/"));
  return doc ? { title: plainTitle(doc.title), description: doc.summary } : {};
}

export default async function DocPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const slug = (await params).slug.join("/");
  const doc = docBySlug(slug);
  if (!doc) notFound();
  const i = docs.indexOf(doc);
  const prev = docs[i - 1];
  const next = docs[i + 1];
  return (
    <div className={styles.articleGrid}>
      <article>
        <div className={styles.crumbs}>
          <Link href="/docs">Docs</Link> / {doc.groupLabel}
        </div>
        <div className={styles.prose} dangerouslySetInnerHTML={{ __html: doc.html }} />
        <div className={styles.meta}>
          {doc.date && <span className={styles.pill}>{doc.date}</span>}
          <span className={styles.pill}>{Math.max(1, Math.round(doc.words / 220))} min read</span>
          <a href={`${REPO_TREE}/${doc.source}`} target="_blank" rel="noreferrer">
            {doc.source} on GitHub
          </a>
        </div>
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
      </article>
      {doc.toc.length > 1 && (
        <aside className={styles.toc} aria-label="On this page">
          <p>On this page</p>
          {doc.toc.map((t) => (
            <a key={t.id} href={`#${t.id}`} className={t.depth === 3 ? styles.sub : undefined}>
              {t.text}
            </a>
          ))}
        </aside>
      )}
    </div>
  );
}
