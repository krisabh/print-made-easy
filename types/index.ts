export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};

export type ShopUploadContext = {
  shopId: string;
  shopCode: string;
  shopName: string;
  /**
   * Whether the shop's current default printer supports Color.
   * Derived server-side from (1) the freshest AgentDevice local default, else
   * (2) legacy Printer.isDefault. Never trust the client.
   */
  colorSupported: boolean;
  /** Server-resolved max upload size (MB) from MAX_UPLOAD_SIZE_MB. */
  maxUploadSizeMb: number;
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
