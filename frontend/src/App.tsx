import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { env } from './common/env.config';
import { useAuth } from './common/AuthContext';
import { useToast } from './common/ToastContext';
import { useDebounce } from './common/useDebounce';
import { FormField } from './common/FormField';
import {
  fetchProducts,
  loginRequest,
  createProductRequest,
  createOrderRequest,
} from './api/store.api';

const productSchema = z.object({
  name: z.string().min(2, 'Nom trop court (min 2 caractères)'),
  priceXof: z.coerce.number().positive('Le prix doit être positif'),
  stock: z.coerce.number().int().nonnegative('Le stock ne peut pas être négatif'),
});

type ProductFormValues = z.infer<typeof productSchema>;

export default function App() {
  const { user, isAuthenticated, login, logout, hasRole } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  // 1. Chargement du catalogue depuis l'API avec TanStack Query
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
  });

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(debouncedSearch.toLowerCase())
  );

  // 2. Connexion rapide Client ou Admin
  const handleQuickLogin = async (role: 'user' | 'admin') => {
    try {
      const email = role === 'admin' ? 'admin@dakartech.sn' : 'client@dakartech.sn';
      await loginRequest(email, role);
      login({ id: '1', email, role });
      showToast(`Connecté en tant que ${role.toUpperCase()}`, 'success');
    } catch {
      showToast('Erreur de connexion au serveur API', 'error');
    }
  };

  // 3. Mutation de commande
  const orderMutation = useMutation({
    mutationFn: (productId: string) => createOrderRequest(productId, 1),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      showToast(`Commande ${order.id} validée (${order.totalXof} FCFA) !`, 'success');
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.message || 'Erreur lors de la commande', 'error');
    },
  });

  // 4. Formulaire Admin d'ajout de produit (React Hook Form + Zod)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
  });

  const createProductMutation = useMutation({
    mutationFn: createProductRequest,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      showToast(`Produit "${created.name}" ajouté au catalogue !`, 'success');
      reset();
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.message || 'Accès refusé', 'error');
    },
  });

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      {/* En-tête */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>{env.VITE_APP_NAME}</h1>
          <small style={{ color: '#64748b' }}>Propulsé par My Backend & Frontend Toolkits</small>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {!isAuthenticated ? (
            <>
              <button onClick={() => handleQuickLogin('user')} style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}>
                Connexion Client
              </button>
              <button onClick={() => handleQuickLogin('admin')} style={{ padding: '0.5rem 1rem', backgroundColor: '#0f172a', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                Connexion Admin
              </button>
            </>
          ) : (
            <>
              <span>{user?.email} (<strong>{user?.role}</strong>)</span>
              <button onClick={() => { localStorage.removeItem('store_token'); logout(); }} style={{ padding: '0.4rem 0.8rem', cursor: 'pointer' }}>
                Déconnexion
              </button>
            </>
          )}
        </div>
      </header>

      {/* Barre de recherche avec useDebounce */}
      <div style={{ marginBottom: '1.5rem' }}>
        <input
          type="text"
          placeholder="Rechercher un produit (ex: MacBook)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
        />
      </div>

      {/* Catalogue Produits */}
      <h2>Catalogue Produits</h2>
      {isLoading ? (
        <p>Chargement du catalogue...</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
          {filteredProducts.map((product) => (
            <div key={product.id} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1rem' }}>
              <h3 style={{ marginTop: 0 }}>{product.name}</h3>
              <p style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#2563eb' }}>
                {product.priceXof.toLocaleString('fr-FR')} FCFA
              </p>
              <p style={{ color: product.stock > 0 ? '#16a34a' : '#dc2626' }}>
                Stock disponible : {product.stock}
              </p>
              <button
                type="button"
                disabled={!isAuthenticated || product.stock === 0 || orderMutation.isPending}
                onClick={() => orderMutation.mutate(product.id)}
                style={{
                  width: '100%',
                  padding: '0.6rem',
                  backgroundColor: isAuthenticated && product.stock > 0 ? '#2563eb' : '#94a3b8',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isAuthenticated && product.stock > 0 ? 'pointer' : 'not-allowed',
                }}
              >
                {!isAuthenticated ? 'Connectez-vous pour commander' : product.stock === 0 ? 'Rupture de stock' : 'Commander (1 unité)'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Espace Administration RBAC (visible uniquement pour role === 'admin') */}
      {hasRole(['admin']) && (
        <section style={{ backgroundColor: '#f8fafc', padding: '1.5rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
          <h2 style={{ marginTop: 0 }}>Administration : Ajouter un produit</h2>
          <form onSubmit={handleSubmit((data) => createProductMutation.mutate(data))}>
            <FormField label="Nom du produit" name="name" registration={register('name')} error={errors.name} />
            <FormField label="Prix (FCFA)" name="priceXof" type="number" registration={register('priceXof')} error={errors.priceXof} />
            <FormField label="Stock initial" name="stock" type="number" registration={register('stock')} error={errors.stock} />
            <button
              type="submit"
              disabled={createProductMutation.isPending}
              style={{ padding: '0.6rem 1.2rem', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              Publier le produit
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
