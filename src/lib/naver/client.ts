import bcrypt from 'bcryptjs'
import { rateLimitDelayMs, shouldRetryRateLimit } from './retry.ts'

const NAVER_API_BASE_URL = 'https://api.commerce.naver.com'

interface NaverTokenResponse {
  access_token: string
  expires_in: number
  token_type: string
}

interface NaverApiConfig {
  clientId: string
  clientSecret: string
  sellerId?: string
}

export class NaverCommerceClient {
  private config: NaverApiConfig
  private accessToken: string | null = null
  private tokenExpiresAt: number = 0
  private tokenRequest: Promise<string> | null = null

  constructor(config: NaverApiConfig) {
    this.config = config
  }

  private async generateSignature(): Promise<{ signature: string; timestamp: number }> {
    const timestamp = Date.now()
    const password = `${this.config.clientId}_${timestamp}`
    const signature = bcrypt.hashSync(password, this.config.clientSecret)
    return {
      signature: Buffer.from(signature).toString('base64'),
      timestamp,
    }
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken
    }

    // De-duplicate concurrent token requests: reuse the in-flight promise
    if (this.tokenRequest) {
      return this.tokenRequest
    }

    this.tokenRequest = this.fetchAccessToken().finally(() => {
      this.tokenRequest = null
    })

    return this.tokenRequest
  }

  private async fetchAccessToken(): Promise<string> {
    const { signature, timestamp } = await this.generateSignature()

    const params = new URLSearchParams()
    params.append('client_id', this.config.clientId)
    params.append('timestamp', timestamp.toString())
    params.append('grant_type', 'client_credentials')
    params.append('client_secret_sign', signature)
    params.append('type', this.config.sellerId ? 'SELLER' : 'SELF')
    if (this.config.sellerId) {
      params.append('account_id', this.config.sellerId)
    }

    const requestToken = () =>
      fetch(`${NAVER_API_BASE_URL}/external/v1/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
        signal: AbortSignal.timeout(10_000),
      })

    let response = await requestToken()
    for (let attempt = 0; shouldRetryRateLimit(response.status, attempt); attempt++) {
      await new Promise((resolve) =>
        setTimeout(resolve, rateLimitDelayMs(attempt, response.headers.get('retry-after')))
      )
      response = await requestToken()
    }

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to get access token: ${error}`)
    }

    const data: NaverTokenResponse = await response.json()
    this.accessToken = data.access_token
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000

    return this.accessToken
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const token = await this.getAccessToken()

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    }

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(body)
    }

    let response = await fetch(`${NAVER_API_BASE_URL}${endpoint}`, options)

    for (let attempt = 0; shouldRetryRateLimit(response.status, attempt); attempt++) {
      const delay = rateLimitDelayMs(attempt, response.headers.get('retry-after'))
      await new Promise((resolve) => setTimeout(resolve, delay))
      response = await fetch(`${NAVER_API_BASE_URL}${endpoint}`, {
        ...options,
        signal: AbortSignal.timeout(10_000),
      })
    }

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`API request failed: ${response.status} - ${error}`)
    }

    return response.json()
  }

  async getOrders(params: {
    fromDate: string
    toDate?: string
    orderStatus?: string
    pageSize?: number
    pageToken?: string
  }): Promise<NaverOrdersResponse> {
    const searchParams = new URLSearchParams()
    searchParams.append('from', params.fromDate)
    if (params.toDate) searchParams.append('to', params.toDate)
    if (params.orderStatus) searchParams.append('orderStatus', params.orderStatus)
    searchParams.append('rangeType', 'PAYED_DATETIME')
    if (params.pageSize) searchParams.append('pageSize', params.pageSize.toString())
    if (params.pageToken) searchParams.append('pageToken', params.pageToken)

    return this.request<NaverOrdersResponse>(
      'GET',
      `/external/v1/pay-order/seller/product-orders?${searchParams.toString()}`
    )
  }

  async getCancelRequests(params: {
    fromDate: string
    toDate?: string
    pageSize?: number
  }): Promise<NaverOrdersResponse> {
    const searchParams = new URLSearchParams()
    searchParams.append('from', params.fromDate)
    if (params.toDate) searchParams.append('to', params.toDate)
    searchParams.append('rangeType', 'CLAIM_REQUESTED_DATETIME')
    searchParams.append('claimStatuses', 'CANCEL_REQUEST')
    if (params.pageSize) searchParams.append('pageSize', params.pageSize.toString())

    return this.request<NaverOrdersResponse>(
      'GET',
      `/external/v1/pay-order/seller/product-orders?${searchParams.toString()}`
    )
  }

  async getProducts(params: {
    pageSize?: number
    pageToken?: string
  } = {}): Promise<NaverProductsResponse> {
    const searchParams = new URLSearchParams()
    if (params.pageSize) searchParams.append('size', params.pageSize.toString())
    if (params.pageToken) searchParams.append('page', params.pageToken)

    return this.request<NaverProductsResponse>(
      'GET',
      `/external/v1/products?${searchParams.toString()}`
    )
  }

  async registerShipment(params: {
    productOrderId: string
    deliveryCompanyCode: string
    trackingNumber: string
  }): Promise<NaverShipmentResponse> {
    return this.registerShipmentsBatch([params])
  }

  /**
   * Register up to 30 shipments in one dispatch call (Naver's batch
   * limit). Per-item failures come back in failProductOrderInfos.
   */
  async registerShipmentsBatch(
    shipments: Array<{
      productOrderId: string
      deliveryCompanyCode: string
      trackingNumber: string
    }>
  ): Promise<NaverShipmentResponse> {
    return this.request<NaverShipmentResponse>(
      'POST',
      '/external/v1/pay-order/seller/product-orders/dispatch',
      {
        dispatchProductOrders: shipments.map((shipment) => ({
          productOrderId: shipment.productOrderId,
          deliveryMethod: 'DELIVERY',
          deliveryCompanyCode: shipment.deliveryCompanyCode,
          trackingNumber: shipment.trackingNumber,
        })),
      }
    )
  }

  async searchProducts(params: {
    keyword?: string
    productStatusTypes?: string[]
    pageSize?: number
    page?: number
  }): Promise<NaverProductsResponse> {
    return this.request<NaverProductsResponse>('POST', '/external/v1/products/search', {
      filter: {
        productName: params.keyword,
        productStatusTypes: params.productStatusTypes || ['SALE'],
      },
      page: params.page || 1,
      size: params.pageSize || 100,
    })
  }

  async getProductDetail(originProductNo: number): Promise<NaverProductDetailResponse> {
    return this.request<NaverProductDetailResponse>(
      'GET',
      `/external/v2/products/origin-products/${originProductNo}`
    )
  }

  async updateProduct(
    originProductNo: number,
    data: NaverUpdateProductRequest
  ): Promise<{ timestamp: string }> {
    return this.request<{ timestamp: string }>(
      'PUT',
      `/external/v2/products/origin-products/${originProductNo}`,
      data as unknown as Record<string, unknown>
    )
  }

  async updateStock(
    originProductNo: number,
    stockQuantity: number
  ): Promise<NaverStockUpdateResponse> {
    return this.request<NaverStockUpdateResponse>(
      'PUT',
      `/external/v2/products/origin-products/${originProductNo}/stock-quantity`,
      { stockQuantity }
    )
  }

  async confirmOrders(productOrderIds: string[]): Promise<NaverConfirmOrderResponse> {
    return this.request<NaverConfirmOrderResponse>(
      'POST',
      '/external/v1/pay-order/seller/product-orders/confirm',
      { productOrderIds }
    )
  }

  async approveCancelRequest(params: {
    productOrderId: string
  }): Promise<NaverCancelResponse> {
    return this.request<NaverCancelResponse>(
      'POST',
      `/external/v1/pay-order/seller/product-orders/${params.productOrderId}/claim/cancel/approve`,
      {}
    )
  }

  async rejectCancelRequest(params: {
    productOrderId: string
    rejectReason: string
  }): Promise<NaverCancelResponse> {
    return this.request<NaverCancelResponse>(
      'POST',
      `/external/v1/pay-order/seller/product-orders/${params.productOrderId}/claim/cancel/reject`,
      {
        rejectDetailedReason: params.rejectReason,
      }
    )
  }

  async getReturnRequests(params: {
    fromDate: string
    toDate?: string
    pageSize?: number
  }): Promise<NaverOrdersResponse> {
    const searchParams = new URLSearchParams()
    searchParams.append('from', params.fromDate)
    if (params.toDate) searchParams.append('to', params.toDate)
    searchParams.append('rangeType', 'CLAIM_REQUESTED_DATETIME')
    searchParams.append('claimStatuses', 'RETURN_REQUEST')
    if (params.pageSize) searchParams.append('pageSize', params.pageSize.toString())

    return this.request<NaverOrdersResponse>(
      'GET',
      `/external/v1/pay-order/seller/product-orders?${searchParams.toString()}`
    )
  }

  async getExchangeRequests(params: {
    fromDate: string
    toDate?: string
    pageSize?: number
  }): Promise<NaverOrdersResponse> {
    const searchParams = new URLSearchParams()
    searchParams.append('from', params.fromDate)
    if (params.toDate) searchParams.append('to', params.toDate)
    searchParams.append('rangeType', 'CLAIM_REQUESTED_DATETIME')
    searchParams.append('claimStatuses', 'EXCHANGE_REQUEST')
    if (params.pageSize) searchParams.append('pageSize', params.pageSize.toString())

    return this.request<NaverOrdersResponse>(
      'GET',
      `/external/v1/pay-order/seller/product-orders?${searchParams.toString()}`
    )
  }

  async approveReturnRequest(params: {
    productOrderId: string
  }): Promise<NaverClaimResponse> {
    return this.request<NaverClaimResponse>(
      'POST',
      `/external/v1/pay-order/seller/product-orders/${params.productOrderId}/claim/return/approve`,
      {}
    )
  }

  async rejectReturnRequest(params: {
    productOrderId: string
    rejectReason: string
  }): Promise<NaverClaimResponse> {
    return this.request<NaverClaimResponse>(
      'POST',
      `/external/v1/pay-order/seller/product-orders/${params.productOrderId}/claim/return/reject`,
      {
        rejectDetailedReason: params.rejectReason,
      }
    )
  }

  async approveExchangeRequest(params: {
    productOrderId: string
  }): Promise<NaverClaimResponse> {
    return this.request<NaverClaimResponse>(
      'POST',
      `/external/v1/pay-order/seller/product-orders/${params.productOrderId}/claim/exchange/approve`,
      {}
    )
  }

  async rejectExchangeRequest(params: {
    productOrderId: string
    rejectReason: string
  }): Promise<NaverClaimResponse> {
    return this.request<NaverClaimResponse>(
      'POST',
      `/external/v1/pay-order/seller/product-orders/${params.productOrderId}/claim/exchange/reject`,
      {
        rejectDetailedReason: params.rejectReason,
      }
    )
  }

  async getSettlements(params: {
    startDate: string
    endDate: string
    pageNumber?: number
    pageSize?: number
  }): Promise<NaverSettlementResponse> {
    const searchParams = new URLSearchParams()
    searchParams.append('startDate', params.startDate)
    searchParams.append('endDate', params.endDate)
    searchParams.append('periodType', 'SETTLE_COMPLETE_DATE')
    if (params.pageNumber) searchParams.append('pageNumber', params.pageNumber.toString())
    if (params.pageSize) searchParams.append('pageSize', params.pageSize.toString())

    return this.request<NaverSettlementResponse>(
      'GET',
      `/external/v1/pay-settle/settle/case?${searchParams.toString()}`
    )
  }

  async getDailySettlements(params: {
    startDate: string
    endDate: string
    pageNumber?: number
  }): Promise<NaverDailySettlementResponse> {
    const searchParams = new URLSearchParams()
    searchParams.append('startDate', params.startDate)
    searchParams.append('endDate', params.endDate)
    if (params.pageNumber) searchParams.append('pageNumber', params.pageNumber.toString())

    return this.request<NaverDailySettlementResponse>(
      'GET',
      `/external/v1/pay-settle/settle/daily?${searchParams.toString()}`
    )
  }

  async getCustomerInquiries(params: {
    startSearchDate: string
    endSearchDate: string
    answered?: boolean
    page?: number
    size?: number
  }): Promise<NaverInquiriesResponse> {
    const searchParams = new URLSearchParams()
    searchParams.append('startSearchDate', params.startSearchDate)
    searchParams.append('endSearchDate', params.endSearchDate)
    if (params.answered !== undefined) searchParams.append('answered', params.answered.toString())
    if (params.page) searchParams.append('page', params.page.toString())
    if (params.size) searchParams.append('size', (params.size || 100).toString())

    return this.request<NaverInquiriesResponse>(
      'GET',
      `/external/v1/pay-user/inquiries?${searchParams.toString()}`
    )
  }

  async getProductQnas(params: {
    fromDate: string
    toDate: string
    answered?: boolean
    page?: number
    size?: number
  }): Promise<NaverQnasResponse> {
    const searchParams = new URLSearchParams()
    searchParams.append('fromDate', params.fromDate)
    searchParams.append('toDate', params.toDate)
    if (params.answered !== undefined) searchParams.append('answered', params.answered.toString())
    if (params.page) searchParams.append('page', params.page.toString())
    if (params.size) searchParams.append('size', (params.size || 100).toString())

    return this.request<NaverQnasResponse>(
      'GET',
      `/external/v1/contents/qnas?${searchParams.toString()}`
    )
  }
}

export interface NaverOrder {
  productOrderId: string
  orderId: string
  orderDate: string
  productName: string
  productOption: string
  quantity: number
  unitPrice: number
  totalPaymentAmount: number
  orderStatus: string
  ordererName: string
  ordererTel: string
  shippingAddress: {
    name: string
    tel1: string
    tel2?: string
    baseAddress: string
    detailAddress: string
    zipCode: string
  }
  shippingMemo?: string
  deliveryCompanyCode?: string
  trackingNumber?: string
}

export interface NaverOrdersResponse {
  data: {
    contents: NaverOrder[]
    totalElements: number
    pageToken?: string
  }
}

export interface NaverChannelProduct {
  originProductNo: number
  channelProductNo: number
  name: string
  sellerManagementCode?: string
  statusType: string
  salePrice: number
  discountedPrice?: number
  stockQuantity: number
  wholeCategoryName?: string
  representativeImage?: {
    url: string
  }
  brandName?: string
  modelName?: string
}

export interface NaverProduct {
  originProductNo: number
  channelProducts: NaverChannelProduct[]
}

export interface NaverProductsResponse {
  contents: NaverProduct[]
  totalElements: number
  page?: number
}

export interface NaverShipmentResponse {
  data: {
    successProductOrderInfos: Array<{
      productOrderId: string
    }>
    failProductOrderInfos: Array<{
      productOrderId: string
      code: string
      message: string
    }>
  }
}

export const NAVER_DELIVERY_COMPANIES = [
  { code: 'CJGLS', name: 'CJ대한통운' },
  { code: 'KGB', name: '로젠택배' },
  { code: 'LOGEN', name: '로젠택배' },
  { code: 'HANJIN', name: '한진택배' },
  { code: 'EPOST', name: '우체국택배' },
  { code: 'LOTTE', name: '롯데택배' },
  { code: 'HDEXP', name: '합동택배' },
  { code: 'CVSNET', name: 'GS편의점택배' },
  { code: 'DAESIN', name: '대신택배' },
  { code: 'ILYANG', name: '일양로지스' },
] as const

export interface NaverProductImage {
  url: string
}

export interface NaverOptionCombination {
  id?: number
  optionName1: string
  optionName2?: string
  optionName3?: string
  optionName4?: string
  stockQuantity: number
  price: number
  sellerManagerCode?: string
  usable?: boolean
}

export interface NaverProductInfoNotice {
  productInfoProvidedNoticeType: string
  wear?: {
    material?: string
    color?: string
    size?: string
    manufacturer?: string
    countryOfOrigin?: string
    washingMethod?: string
    yearMonth?: string
    warrantyPolicy?: string
    customerServicePhoneNumber?: string
  }
  shoes?: {
    material?: string
    color?: string
    size?: string
    height?: string
    manufacturer?: string
    countryOfOrigin?: string
    warrantyPolicy?: string
    customerServicePhoneNumber?: string
  }
  food?: {
    foodType?: string
    producer?: string
    location?: string
    packingDate?: string
    expirationDate?: string
    weight?: string
    quantity?: string
    rawMaterialContent?: string
    nutrient?: string
    geneticallyModified?: string
    customerServicePhoneNumber?: string
  }
  cosmetic?: {
    capacity?: string
    mainIngredient?: string
    expirationDate?: string
    usageMethod?: string
    manufacturer?: string
    customerServicePhoneNumber?: string
  }
  electronics?: {
    productName?: string
    modelName?: string
    certificationType?: string
    ratedVoltage?: string
    powerConsumption?: string
    releaseDate?: string
    manufacturer?: string
    countryOfOrigin?: string
    size?: string
    weight?: string
    mainSpec?: string
    warrantyPolicy?: string
    customerServicePhoneNumber?: string
  }
  etc?: {
    itemName?: string
    modelName?: string
    manufacturer?: string
    countryOfOrigin?: string
    customerServicePhoneNumber?: string
  }
  [key: string]: unknown
}

export interface NaverSeoInfo {
  pageTitle?: string
  metaDescription?: string
  sellerTags?: Array<{ code?: number; text?: string }>
}

export interface NaverProductDetail {
  originProductNo: number
  name: string
  salePrice: number
  stockQuantity: number
  detailContent: string
  saleType?: string
  statusType?: string
  leafCategoryId?: string
  representativeImage?: NaverProductImage
  optionalImages?: NaverProductImage[]
  productInfoProvidedNotice?: NaverProductInfoNotice
  productAttributes?: Array<{
    attributeId: number
    attributeValueId?: number
    attributeValue?: string
  }>
  saleStartDate?: string
  saleEndDate?: string
  sellerManagementCode?: string
  brandName?: string
  modelName?: string
  manufacturerName?: string
  originAreaInfo?: {
    originAreaCode?: string
    content?: string
    plural?: boolean
    importer?: string
  }
  seoInfo?: NaverSeoInfo
  deliveryInfo?: {
    deliveryType?: string
    deliveryAttributeType?: string
    deliveryCompany?: string
    outboundLocationId?: string
    returnCenterCode?: string
    deliveryFee?: {
      deliveryFeeType?: string
      baseFee?: number
      freeConditionalAmount?: number
      repeatQuantity?: number
      secondBaseQuantity?: number
      secondExtraFee?: number
      thirdBaseQuantity?: number
      thirdExtraFee?: number
      deliveryFeeByArea?: {
        deliveryAreaType?: string
        area2extraFee?: number
        area3extraFee?: number
      }
    }
    claimDeliveryInfo?: {
      returnDeliveryFee?: number
      exchangeDeliveryFee?: number
      returnDeliveryCompanyPriorityType?: string
      returnCenterAddressType?: string
      returnCenterAddress?: string
    }
    installationFee?: boolean
    expectedDeliveryPeriodType?: string
    expectedDeliveryPeriodDirectInput?: number
    todayStockQuantity?: number
    customMadeInfo?: {
      customMade?: boolean
      customMadeType?: string
    }
  }
  images?: {
    representativeImage?: NaverProductImage
    optionalImages?: NaverProductImage[]
  }
  detailAttribute?: {
    naverShoppingSearchInfo?: {
      manufacturerDate?: string
      brandCertificationYn?: boolean
      modelName?: string
      modelNo?: string
      catalogId?: string
      brandName?: string
      brandId?: number
      manufacturerName?: string
      catalogMatchingYn?: boolean
    }
    afterServiceInfo?: {
      afterServiceTelephoneNumber?: string
      afterServiceGuideContent?: string
    }
    purchaseQuantityInfo?: {
      minPurchaseQuantity?: number
      maxPurchaseQuantityPerId?: number
      maxPurchaseQuantityPerOrder?: number
    }
    originAreaInfo?: {
      originAreaCode?: string
      content?: string
      importer?: string
    }
    taxType?: string
    certificationTargetExcludeContent?: {
      kcExemptionType?: string
      kcCertifiedProductExclusionYn?: string
      greenCertifiedProductExclusionYn?: string
    }
    sellerCodeInfo?: {
      sellerManagementCode?: string
      sellerBarcode?: string
      sellerCustomCode1?: string
      sellerCustomCode2?: string
    }
    minorPurchasable?: boolean
    productInfoProvidedNotice?: NaverProductInfoNotice
    optionInfo?: {
      simpleOptionSortType?: string
      optionSimple?: Array<{
        id?: number
        groupName?: string
        name?: string
        usable?: boolean
      }>
      optionCustom?: Array<{
        id?: number
        groupName?: string
        name?: string
        usable?: boolean
      }>
      optionCombinations?: NaverOptionCombination[]
      optionCombinationSortType?: string
      optionCombinationGroupNames?: {
        optionGroupName1?: string
        optionGroupName2?: string
        optionGroupName3?: string
        optionGroupName4?: string
      }
      useStockManagement?: boolean
      optionDeliveryAttributes?: Array<{
        optionCombinationId?: number
        deliveryAttributeType?: string
      }>
    }
    supplementProductInfo?: {
      sortType?: string
      supplementProducts?: Array<{
        id?: number
        groupName?: string
        name?: string
        price?: number
        stockQuantity?: number
        sellerManagementCode?: string
        usable?: boolean
      }>
    }
    isbnInfo?: {
      isbn13?: string
      issn?: string
      independentPublicationYn?: boolean
    }
    eventPhrase?: {
      eventPhraseContent?: string
      eventPhraseEnabled?: boolean
    }
    productCertificationInfos?: Array<{
      certificationInfoId?: number
      certificationKindType?: string
      name?: string
      certificationNumber?: string
      certificationMark?: boolean
      companyName?: string
      certificationDate?: string
    }>
  }
  customerBenefit?: {
    immediateDiscountPolicy?: {
      discountMethod?: {
        value?: number
        unitType?: string
      }
      mobileDiscountMethod?: {
        value?: number
        unitType?: string
      }
    }
    purchasePointPolicy?: {
      value?: number
      unitType?: string
    }
    reviewPointPolicy?: {
      textReviewPoint?: number
      photoVideoReviewPoint?: number
      afterUseTextReviewPoint?: number
      afterUsePhotoVideoReviewPoint?: number
      storeMemberReviewPoint?: number
    }
    freeInterestPolicy?: {
      value?: number
    }
    giftPolicy?: {
      giftName?: string
    }
    multiPurchaseDiscount?: {
      discountMethod?: {
        value?: number
        unitType?: string
      }
      orderValue?: number
      orderValueUnitType?: string
    }
  }
  category?: {
    categoryId?: string
    wholeCategoryId?: string
    wholeCategoryName?: string
  }
  channelProductDisplayStatusType?: string
}

export interface NaverProductDetailResponse {
  originProduct: NaverProductDetail
}

export interface NaverSettlement {
  settlementNo: string
  settleDate: string
  orderNo: string
  productOrderNo: string
  productName: string
  quantity: number
  saleAmount: number
  commissionAmount: number
  deliveryFeeAmount: number
  discountAmount: number
  settleAmount: number
  settleStatus: string
}

export interface NaverSettlementResponse {
  contents: NaverSettlement[]
  totalElements: number
  totalPages: number
  pageNumber: number
}

export interface NaverDailySettlement {
  settleDate: string
  orderCount: number
  salesAmount: number
  commissionAmount: number
  deliveryFeeAmount: number
  discountAmount: number
  settleAmount: number
}

export interface NaverDailySettlementResponse {
  contents: NaverDailySettlement[]
  totalElements: number
}

export interface NaverUpdateProductRequest {
  originProduct: {
    name?: string
    salePrice?: number
    stockQuantity?: number
    detailContent?: string
    leafCategoryId?: string
    representativeImage?: NaverProductImage
    optionalImages?: NaverProductImage[]
    sellerManagementCode?: string
    brandName?: string
    modelName?: string
    manufacturerName?: string
    saleStartDate?: string
    saleEndDate?: string
    originAreaInfo?: {
      originAreaCode?: string
      content?: string
      plural?: boolean
    }
    deliveryInfo?: {
      deliveryType?: string
      deliveryAttributeType?: string
      deliveryFee?: {
        deliveryFeeType?: string
        baseFee?: number
        freeConditionalAmount?: number
        deliveryFeeByArea?: {
          deliveryAreaType?: string
          area2extraFee?: number
          area3extraFee?: number
        }
      }
      claimDeliveryInfo?: {
        returnDeliveryFee?: number
        exchangeDeliveryFee?: number
      }
    }
    detailAttribute?: {
      naverShoppingSearchInfo?: {
        manufacturerDate?: string
        brandCertificationYn?: boolean
        modelName?: string
      }
      afterServiceInfo?: {
        afterServiceTelephoneNumber?: string
        afterServiceGuideContent?: string
      }
      purchaseQuantityInfo?: {
        minPurchaseQuantity?: number
        maxPurchaseQuantityPerId?: number
        maxPurchaseQuantityPerOrder?: number
      }
      originAreaInfo?: {
        originAreaCode?: string
        content?: string
      }
      taxType?: string
      optionInfo?: {
        optionCombinations?: Array<{
          id?: number
          optionName1: string
          optionName2?: string
          optionName3?: string
          stockQuantity: number
          price: number
          usable?: boolean
        }>
        optionCombinationGroupNames?: {
          optionGroupName1?: string
          optionGroupName2?: string
          optionGroupName3?: string
        }
      }
    }
    customerBenefit?: {
      immediateDiscountPolicy?: {
        discountMethod?: {
          value?: number
          unitType?: string
        }
      }
    }
  }
}

export interface NaverConfirmOrderResponse {
  data: {
    successProductOrderInfos: Array<{ productOrderId: string }>
    failProductOrderInfos: Array<{
      productOrderId: string
      code: string
      message: string
    }>
  }
}

export interface NaverCancelResponse {
  data: {
    successProductOrderIds: string[]
    failProductOrderInfos: Array<{
      productOrderId: string
      code: string
      message: string
    }>
  }
}

export interface NaverClaimResponse {
  data: {
    successProductOrderIds: string[]
    failProductOrderInfos: Array<{
      productOrderId: string
      code: string
      message: string
    }>
  }
}

export interface NaverStockUpdateRequest {
  originProductNo: number
  stockQuantity: number
}

export interface NaverStockUpdateResponse {
  successProductNos: number[]
  failProductNos: Array<{
    originProductNo: number
    code: string
    message: string
  }>
}

export interface NaverInquiry {
  inquiryNo: string
  category: string
  title: string
  inquiryContent: string
  answered: boolean
  answerContent?: string
  answeredDate?: string
  orderId?: string
  productOrderId?: string
  productName?: string
  customerId: string
  createdDate: string
}

export interface NaverInquiriesResponse {
  contents: NaverInquiry[]
  totalElements: number
  page: number
  size: number
}

export interface NaverQna {
  questionId: string
  question: string
  answer?: string
  answered: boolean
  answeredDate?: string
  productId: string
  productName: string
  maskedWriterId: string
  createdDate: string
}

export interface NaverQnasResponse {
  contents: NaverQna[]
  totalElements: number
  page: number
  size: number
}
