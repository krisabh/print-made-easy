export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

export type ShopUploadContext = {
  shopId: string;
  shopCode: string;
  shopName: string;
  pricing: {
    bwSingle: number;
    bwDouble: number;
    colorSingle: number;
    colorDouble: number;
    minimumCharge: number;
  };
};

export type UploadSuccessData = {
  jobId: string;
  jobNumber: string;
  totalPrice: number;
  totalPages: number;
  copies: number;
};

export type DateFilter = "today" | "yesterday" | "last7" | "month" | "all";
export type StatusFilter =
  | "ALL"
  | "PENDING"
  | "PRINTING"
  | "READY_FOR_PICKUP"
  | "DELIVERED"
  | "CANCELLED";
