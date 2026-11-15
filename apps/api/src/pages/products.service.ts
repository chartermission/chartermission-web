import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { PRODUCTS_MAX_PER_PAGE, type Ok, type ProductInput, type ProductView } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { files, pageProducts, pages } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { mediaUrl } from '../core/members.service.js';
import { AuditService } from '../infra/audit.service.js';
import { Errors } from '../common/errors.js';
import { isUuid } from '../media/uuid-param.js';
import { isPagesStaff, pageRef, PagesService, type PageRow } from './pages.service.js';

type ProductRow = typeof pageProducts.$inferSelect;

/**
 * A page's products (contracts/services.ts): a small catalogue with prices as text. Everyone sees
 * the active products of a live page; its admins (and pages staff) see hidden ones too and manage
 * them while the page is live.
 */
@Injectable()
export class PageProductsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly pages: PagesService,
    private readonly audit: AuditService,
  ) {}

  /** GET /pages/{slug}/products */
  async list(viewer: AuthUser, slug: string): Promise<ProductView[]> {
    const { row, role } = await this.pages.visibleRow(viewer, slug);
    const manager = !!role || isPagesStaff(viewer);
    const rows = await this.db
      .select()
      .from(pageProducts)
      .where(and(eq(pageProducts.pageId, row.id), manager ? undefined : eq(pageProducts.active, true)))
      .orderBy(asc(pageProducts.position), asc(pageProducts.createdAt), asc(pageProducts.id));
    return this.views(row, rows);
  }

  /** POST /pages/{slug}/products */
  async create(user: AuthUser, slug: string, input: ProductInput, ip?: string): Promise<ProductView> {
    const row = await this.writablePage(user, slug);
    const imageFileIds = await this.assertImages(user.id, input.imageFileIds, []);
    const product = await this.db.transaction(async (tx) => {
      // Lock the page so two products added at once can't pass the limit together.
      await tx.select({ id: pages.id }).from(pages).where(eq(pages.id, row.id)).for('update');
      const [stats] = await tx
        .select({ n: sql<number>`count(*)::int`, next: sql<number>`coalesce(max(${pageProducts.position}) + 1, 0)::int` })
        .from(pageProducts)
        .where(eq(pageProducts.pageId, row.id));
      if ((stats?.n ?? 0) >= PRODUCTS_MAX_PER_PAGE) throw Errors.conflict(`A page can list up to ${PRODUCTS_MAX_PER_PAGE} products`);
      const [created] = await tx
        .insert(pageProducts)
        .values({
          pageId: row.id,
          name: input.name,
          description: input.description,
          price: input.price || null,
          imageFileIds,
          link: input.link || null,
          active: input.active,
          position: input.position ?? Math.min(stats?.next ?? 0, 1000),
          createdBy: user.id,
        })
        .returning();
      return created!;
    });
    await this.audit.record({ actorId: user.id, action: 'page.product_created', targetType: 'page', targetId: row.id, after: { productId: product.id, name: product.name }, ip });
    return (await this.views(row, [product]))[0]!;
  }

  /** PATCH /pages/{slug}/products/{id}: the whole product, as the form sends it. */
  async update(user: AuthUser, slug: string, productId: string, input: ProductInput, ip?: string): Promise<ProductView> {
    const row = await this.writablePage(user, slug);
    const before = await this.product(row.id, productId);
    const imageFileIds = await this.assertImages(user.id, input.imageFileIds, before.imageFileIds);
    const [updated] = await this.db
      .update(pageProducts)
      .set({
        name: input.name,
        description: input.description,
        price: input.price || null,
        imageFileIds,
        link: input.link || null,
        active: input.active,
        position: input.position ?? before.position,
        updatedAt: new Date(),
      })
      .where(eq(pageProducts.id, before.id))
      .returning();
    await this.audit.record({ actorId: user.id, action: 'page.product_updated', targetType: 'page', targetId: row.id, after: { productId: before.id, fields: Object.keys(input) }, ip });
    return (await this.views(row, [updated!]))[0]!;
  }

  /** DELETE /pages/{slug}/products/{id} */
  async remove(user: AuthUser, slug: string, productId: string, ip?: string): Promise<Ok> {
    const row = await this.writablePage(user, slug);
    const before = await this.product(row.id, productId);
    await this.db.delete(pageProducts).where(eq(pageProducts.id, before.id));
    await this.audit.record({ actorId: user.id, action: 'page.product_deleted', targetType: 'page', targetId: row.id, before: { productId: before.id, name: before.name }, ip });
    return { ok: true };
  }

  /** The page, for one of its admins (or pages staff), while it is live. */
  private async writablePage(user: AuthUser, slug: string): Promise<PageRow> {
    const { row } = await this.pages.editableRow(user, slug);
    if (row.status !== 'active') throw Errors.conflict('This page isn’t live, so its products can’t be changed right now.');
    return row;
  }

  private async product(pageId: string, productId: string): Promise<ProductRow> {
    if (!isUuid(productId)) throw Errors.notFound('That product');
    const [found] = await this.db
      .select()
      .from(pageProducts)
      .where(and(eq(pageProducts.id, productId), eq(pageProducts.pageId, pageId)))
      .limit(1);
    if (!found) throw Errors.notFound('That product');
    return found;
  }

  /**
   * Pictures must be the caller's own clean product_image uploads. Pictures already on the product
   * may stay even when another admin uploaded them. Returns the ids in order, without repeats.
   */
  private async assertImages(userId: string, ids: string[], current: string[]): Promise<string[]> {
    const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
    if (!unique.length) return [];
    const kept = new Set(current);
    const rows = await this.db
      .select({ id: files.id, ownerId: files.ownerId, purpose: files.purpose, scanStatus: files.scanStatus })
      .from(files)
      .where(inArray(files.id, unique));
    for (const id of unique) {
      const file = rows.find((r) => r.id === id);
      const usable = !!file && file.purpose === 'product_image' && file.scanStatus === 'clean' && (file.ownerId === userId || kept.has(id));
      if (!usable) throw Errors.validation({ imageFileIds: 'Upload the picture again' });
    }
    return unique;
  }

  private async views(page: PageRow, rows: ProductRow[]): Promise<ProductView[]> {
    const imageIds = [...new Set(rows.flatMap((r) => r.imageFileIds))];
    const clean = imageIds.length
      ? new Set(
          (await this.db.select({ id: files.id }).from(files).where(and(inArray(files.id, imageIds), eq(files.scanStatus, 'clean')))).map((f) => f.id),
        )
      : new Set<string>();
    const ref = pageRef(page);
    return rows.map((r) => ({
      id: r.id,
      page: ref,
      name: r.name,
      description: r.description,
      price: r.price,
      imageUrls: r.imageFileIds.filter((id) => clean.has(id)).map((id) => mediaUrl(id)!),
      imageFileIds: r.imageFileIds.filter((id) => clean.has(id)),
      link: r.link,
      active: r.active,
      position: r.position,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
