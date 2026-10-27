/**
 * Every GraphQL document the app sends, as named exported strings (SPEC §8).
 * No query requests customer, email, phone, address, payment or financial fields.
 * Cost notes: `OrdersByQuery` ≈ 302 points (never add lineItems to it); `OrderByName` ≈ 330.
 */

const ORDER_FIELDS = `
      id
      legacyResourceId
      name
      number
      createdAt
      closed
      cancelledAt
      displayFulfillmentStatus
      tags
      currentSubtotalLineItemsQuantity
      itemStatus: metafield(namespace: "trax_production", key: "item_status") { value compareDigest }
      productionDate: metafield(namespace: "custom", key: "production_date") { value }
      custody: metafield(namespace: "custom", key: "custody") { value }
      giveTo: metafield(namespace: "custom", key: "give_to") { value }
      dueDate: metafield(namespace: "trax_production", key: "due_date") { value }`;

/** One order by number. `$q` is `name:#<digits>`; the caller picks the node whose `number` matches. */
export const OrderByName = `query OrderByName($q: String!) {
  orders(first: 3, query: $q) {
    nodes {${ORDER_FIELDS}
      lastUpdatedAt: metafield(namespace: "trax_production", key: "last_updated_at") { value }
      lastUpdatedBy: metafield(namespace: "trax_production", key: "last_updated_by") { value }
      summary: metafield(namespace: "trax_production", key: "summary") { value }
      lineItems(first: 100) {
        nodes {
          id
          title
          variantTitle
          sku
          quantity
          currentQuantity
          requiresShipping
          isGiftCard
          customAttributes { key value }
        }
      }
    }
  }
}`;

/** List walk: tagged orders and the watch query. No line items (cost cap). */
export const OrdersByQuery = `query OrdersByQuery($q: String!, $cursor: String) {
  orders(first: 50, query: $q, sortKey: CREATED_AT, reverse: true, after: $cursor) {
    nodes {${ORDER_FIELDS}
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** The four order metafields in one atomic call; `item_status` carries `compareDigest`. */
export const SetOrderStatus = `mutation SetOrderStatus($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { key compareDigest updatedAt }
    userErrors { field message code }
  }
}`;

export const AddTags = `mutation AddTags($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    node { id }
    userErrors { field message }
  }
}`;

export const RemoveTags = `mutation RemoveTags($id: ID!, $tags: [String!]!) {
  tagsRemove(id: $id, tags: $tags) {
    node { id }
    userErrors { field message }
  }
}`;

/** Both shop metafields with their digests; `shop.id` is the ownerId for writes. */
export const ShopSettings = `query ShopSettings {
  shop {
    id
    name
    settings: metafield(namespace: "trax_production", key: "settings") { value compareDigest }
    staff: metafield(namespace: "trax_production", key: "staff") { value compareDigest }
  }
}`;

export const SetShopSettings = `mutation SetShopSettings($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { key compareDigest updatedAt }
    userErrors { field message code }
  }
}`;

export const AccessScopes = `query AccessScopes {
  currentAppInstallation {
    accessScopes { handle }
  }
}`;

export const ShopInfo = `query ShopInfo {
  shop { id name myshopifyDomain }
}`;

/** Setup script only. */
export const MetafieldDefinitions = `query MetafieldDefinitions($ownerType: MetafieldOwnerType!) {
  metafieldDefinitions(ownerType: $ownerType, namespace: "trax_production", first: 20) {
    nodes {
      key
      name
      type { name }
      access { storefront }
    }
  }
}`;

export const CreateMetafieldDefinition = `mutation CreateMetafieldDefinition($d: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $d) {
    createdDefinition {
      id
      key
      type { name }
      access { admin storefront }
    }
    userErrors { field message code }
  }
}`;

export const ALL_DOCUMENTS = {
  OrderByName,
  OrdersByQuery,
  SetOrderStatus,
  AddTags,
  RemoveTags,
  ShopSettings,
  SetShopSettings,
  AccessScopes,
  ShopInfo,
  MetafieldDefinitions,
  CreateMetafieldDefinition,
} as const;
