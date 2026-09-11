import type { ReactNode } from 'react';
import type { Business, BusinessApplication } from '../../types';

// Shared V2 flow visual-slot contract. Extracted from the retired V2App shell
// so the product-flow surfaces own their slot types directly (#375 F4).
export interface V2FlowVisualSlots {
  hero?: ReactNode;
  cinematic?: ReactNode;
  businessMedia?: (business: Business, context: 'card' | 'detail') => ReactNode;
  promotionMedia?: (application: BusinessApplication) => ReactNode;
}
