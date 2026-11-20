import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError, asyncHandler } from '../common/error.middleware';
import { validateRequest } from '../common/validate.middleware';
import { AuthService } from '../common/auth.service';
import { createAuthMiddleware, authorizeRoles } from '../common/auth.middleware';
import { CacheClient, cacheMiddleware, invalidateCacheKeys } from '../common/cache.middleware';
import { verifyHmacWebhook } from '../common/webhook.middleware';

export const prisma = new PrismaClient();

export function createStoreRouter(authService: AuthService, cacheClient: CacheClient) {
  const router = Router();
  const authenticate = createAuthMiddleware(authService);

  // Initialisation de 2 produits par défaut si la table MySQL est vide
  prisma.product.count().then(async (count) => {
    if (count === 0) {
      await prisma.product.createMany({
        data: [
          { name: 'MacBook Pro M3', priceXof: 1250000, stock: 5 },
          { name: 'Écran Dell UltraSharp 27"', priceXof: 320000, stock: 12 },
        ],
      });
    }
  });

  // 1. Authentification rapide
  router.post(
    '/auth/login',
    validateRequest({
      body: z.object({
        email: z.string().email(),
        role: z.enum(['user', 'admin']).default('user'),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { email, role } = req.body;
      const accessToken = authService.generateAccessToken({
        userId: `usr-${Date.now()}`,
        email,
        role,
      });
      res.status(200).json({ success: true, accessToken, user: { email, role } });
    })
  );

  // 2. Catalogue Produits depuis MySQL + Cache Redis
  router.get(
    '/products',
    cacheMiddleware(cacheClient, 120, 'store'),
    asyncHandler(async (_req, res) => {
      const products = await prisma.product.findMany({
        orderBy: { createdAt: 'asc' },
      });
      res.status(200).json({ success: true, data: products });
    })
  );

  // 3. Ajout d'un produit en MySQL (Admin uniquement + Invalidation du cache)
  router.post(
    '/products',
    authenticate,
    authorizeRoles('admin'),
    validateRequest({
      body: z.object({
        name: z.string().min(2),
        priceXof: z.number().positive(),
        stock: z.number().int().nonnegative(),
      }),
    }),
    asyncHandler(async (req, res) => {
      const newProduct = await prisma.product.create({
        data: req.body,
      });

      await invalidateCacheKeys(cacheClient, ['/api/products'], 'store');
      res.status(201).json({ success: true, data: newProduct });
    })
  );

  // 4. Passage de commande TRANSACTIONNEL en MySQL (Stock + Commande atomiques)
  router.post(
    '/orders',
    authenticate,
    validateRequest({
      body: z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
      }),
    }),
    asyncHandler(async (req, res) => {
      const { productId, quantity } = req.body;

      // Transaction SQL atomique : si une étape échoue, tout est annulé (ROLLBACK)
      const order = await prisma.$transaction(async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: productId },
        });

        if (!product) {
          throw new AppError('Produit introuvable', 404);
        }
        if (product.stock < quantity) {
          throw new AppError(`Stock insuffisant (disponible : ${product.stock})`, 400);
        }

        await tx.product.update({
          where: { id: product.id },
          data: { stock: { decrement: quantity } },
        });

        return tx.order.create({
          data: {
            userId: req.user!.userId,
            productId: product.id,
            quantity,
            totalXof: product.priceXof * quantity,
            status: 'PENDING',
          },
        });
      });

      await invalidateCacheKeys(cacheClient, ['/api/products'], 'store');
      res.status(201).json({ success: true, data: order });
    })
  );

  // 5. Webhook de paiement sécurisé HMAC-SHA256 -> mise à jour statut PAID en MySQL
  router.post(
    '/webhooks/payment',
    verifyHmacWebhook({ secret: process.env.WEBHOOK_SECRET || 'whsec_test' }),
    asyncHandler(async (req, res) => {
      const { orderId, status } = req.body;
      const existingOrder = await prisma.order.findUnique({
        where: { id: orderId },
      });

      if (!existingOrder) {
        throw new AppError('Commande associée au paiement introuvable', 404);
      }

      const updatedOrder =
        status === 'SUCCEEDED'
          ? await prisma.order.update({
              where: { id: orderId },
              data: { status: 'PAID' },
            })
          : existingOrder;

      res.status(200).json({ success: true, order: updatedOrder });
    })
  );

  return router;
}
