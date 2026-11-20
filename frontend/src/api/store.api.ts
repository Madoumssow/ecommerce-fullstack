import { env } from '../common/env.config';
import { createHttpClient } from '../common/http.client';

export interface Product {
  id: string;
  name: string;
  priceXof: number;
  stock: number;
}

export const storeApi = createHttpClient({
  baseURL: env.VITE_API_URL,
  tokenStorage: {
    getAccessToken: () => localStorage.getItem('store_token'),
    setAccessToken: (token) => localStorage.setItem('store_token', token),
    clearTokens: () => localStorage.removeItem('store_token'),
  },
  refreshTokenFn: async () => {
    throw new Error('Session expirée, veuillez vous reconnecter');
  },
});

export async function loginRequest(email: string, role: 'user' | 'admin') {
  const { data } = await storeApi.post('/auth/login', { email, role });
  localStorage.setItem('store_token', data.accessToken);
  return data;
}

export async function fetchProducts(): Promise<Product[]> {
  const { data } = await storeApi.get('/products');
  return data.data;
}

export async function createProductRequest(payload: {
  name: string;
  priceXof: number;
  stock: number;
}): Promise<Product> {
  const { data } = await storeApi.post('/products', payload);
  return data.data;
}

export async function createOrderRequest(productId: string, quantity: number) {
  const { data } = await storeApi.post('/orders', { productId, quantity });
  return data.data;
}
