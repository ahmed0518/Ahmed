/** Response shapes of the documents in queries.ts. */

export interface RawMetafield {
  value: string;
  compareDigest?: string | null;
}

export interface RawLineItem {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  currentQuantity: number;
  requiresShipping: boolean;
  isGiftCard: boolean;
  customAttributes: { key: string; value: string | null }[];
}

export interface RawOrderNode {
  id: string;
  legacyResourceId: string;
  name: string;
  number: number;
  createdAt: string;
  closed: boolean;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  tags: string[];
  currentSubtotalLineItemsQuantity: number;
  lineItems?: { nodes: RawLineItem[] };
  itemStatus: RawMetafield | null;
  lastUpdatedAt?: RawMetafield | null;
  lastUpdatedBy?: RawMetafield | null;
  summary?: RawMetafield | null;
  productionDate: RawMetafield | null;
  custody: RawMetafield | null;
  giveTo: RawMetafield | null;
  dueDate: RawMetafield | null;
}

export interface OrderByNameData {
  orders: { nodes: RawOrderNode[] };
}

export interface OrdersByQueryData {
  orders: {
    nodes: RawOrderNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export interface UserError {
  field: string[] | null;
  message: string;
  code?: string | null;
}

export interface MetafieldsSetData {
  metafieldsSet: {
    metafields: { key: string; compareDigest: string | null; updatedAt: string }[] | null;
    userErrors: UserError[];
  };
}

export interface MetafieldsSetInput {
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
  compareDigest?: string | null;
}

export interface TagsAddData {
  tagsAdd: { node: { id: string } | null; userErrors: UserError[] } | null;
}

export interface TagsRemoveData {
  tagsRemove: { node: { id: string } | null; userErrors: UserError[] } | null;
}

export interface ShopSettingsData {
  shop: {
    id: string;
    name: string;
    settings: RawMetafield | null;
    staff: RawMetafield | null;
  };
}

export interface AccessScopesData {
  currentAppInstallation: { accessScopes: { handle: string }[] };
}

export interface ShopInfoData {
  shop: { id: string; name: string; myshopifyDomain: string };
}

export interface MetafieldDefinitionsData {
  metafieldDefinitions: {
    nodes: { key: string; name: string; type: { name: string }; access: { storefront: string | null } | null }[];
  };
}

export interface CreateMetafieldDefinitionData {
  metafieldDefinitionCreate: {
    createdDefinition: { id: string; key: string; type: { name: string }; access: { admin: string | null; storefront: string | null } | null } | null;
    userErrors: UserError[];
  };
}
