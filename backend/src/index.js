import { handleHello } from "./routes/hello.js";
import { handleTestUsers } from "./routes/test-users.js";
import { handleComplexes } from "./routes/complexes.js";
import { handleBuildings } from "./routes/buildings.js";
import { handleMe } from "./routes/me.js";

import {
  handleResidentVerification,
} from "./routes/resident-verifications.js";

import {
  handleMyResidentVerification,
} from "./routes/my-resident-verification.js";

import {
  handleAdminResidentVerificationList,
} from "./routes/admin-resident-verification-list.js";

import {
  handleApproveResidentVerification,
} from "./routes/admin-resident-verifications.js";

import {
  handleBusinesses,
} from "./routes/businesses.js";

import {
  handleAdminBusinessList,
  handleApproveBusiness,
} from "./routes/admin-businesses.js";

import {
  handleBusinessCategories,
  handleMyBusinesses,
  handleUpdateMyBusiness,
  handleBusinessHours,
  handleBusinessBenefits,
} from "./routes/business-management.js";

import {
  handleHome,
  handleBusinessDetail,
  handleBusinessBySlug,
  handleBusinessSave,
  handleMySavedBusinesses,
  handleBusinessReviews,
  handleMyReviewMutation,
  handleReviewReply,
} from "./routes/business-discovery.js";

import {
  handleShopApplicationCreate,
  handleShopReportCreate,
  handleMyShopApplications,
  handleMyShopApplicationUpdate,
  handleMyShopApplicationSubmit,
  handleAdminShopApplications,
  handleAdminShopApplicationAction,
} from "./routes/business-applications.js";

import {
  handleShopApplicationFileUpload,
  handleMyShopApplicationFiles,
  handleShopApplicationFileDelete,
  handlePublicShopApplicationFile,
  handlePrivateShopApplicationFile,
} from "./routes/business-files.js";


export default {
  async fetch(request, env) {
    const url =
      new URL(request.url);


    // =====================================================
    // BASIC
    // =====================================================

    if (
      url.pathname ===
      "/api/hello"
    ) {
      return handleHello();
    }

    if (
      url.pathname ===
      "/api/test-users"
    ) {
      return handleTestUsers(env);
    }

    if (
      url.pathname ===
      "/api/complexes"
    ) {
      return handleComplexes(env);
    }

    if (
      url.pathname ===
      "/api/buildings"
    ) {
      return handleBuildings(env);
    }

    if (
      url.pathname ===
      "/api/me"
    ) {
      return handleMe(
        request,
        env
      );
    }

    if (
      url.pathname ===
      "/api/home"
    ) {
      return handleHome(
        request,
        env
      );
    }


    // =====================================================
    // RESIDENT
    // =====================================================

    if (
      url.pathname ===
      "/api/me/resident-verification"
    ) {
      return handleMyResidentVerification(
        request,
        env
      );
    }

    if (
      url.pathname ===
      "/api/resident-verifications"
    ) {
      return handleResidentVerification(
        request,
        env
      );
    }

    if (
      url.pathname ===
      "/api/admin/resident-verifications"
    ) {
      return handleAdminResidentVerificationList(
        request,
        env
      );
    }

    const residentApproveMatch =
      url.pathname.match(
        /^\/api\/admin\/resident-verifications\/(\d+)\/approve$/
      );

    if (
      residentApproveMatch
    ) {
      return handleApproveResidentVerification(
        request,
        env,
        residentApproveMatch[1]
      );
    }


    // =====================================================
    // PHASE 3 — APPLICATION / REPORT
    // =====================================================

    if (
      url.pathname ===
      "/api/shop-applications"
    ) {
      return handleShopApplicationCreate(
        request,
        env
      );
    }

    if (
      url.pathname ===
      "/api/shop-reports"
    ) {
      return handleShopReportCreate(
        request,
        env
      );
    }

    if (
      url.pathname ===
      "/api/me/shop-applications"
    ) {
      return handleMyShopApplications(
        request,
        env
      );
    }

    const myApplicationSubmitMatch =
      url.pathname.match(
        /^\/api\/me\/shop-applications\/(\d+)\/submit$/
      );

    if (
      myApplicationSubmitMatch
    ) {
      return handleMyShopApplicationSubmit(
        request,
        env,
        myApplicationSubmitMatch[1]
      );
    }

    const myApplicationFileDeleteMatch =
      url.pathname.match(
        /^\/api\/me\/shop-applications\/(\d+)\/files\/(\d+)$/
      );

    if (
      myApplicationFileDeleteMatch
    ) {
      return handleShopApplicationFileDelete(
        request,
        env,
        myApplicationFileDeleteMatch[1],
        myApplicationFileDeleteMatch[2]
      );
    }

    const myApplicationFilesMatch =
      url.pathname.match(
        /^\/api\/me\/shop-applications\/(\d+)\/files$/
      );

    if (
      myApplicationFilesMatch
    ) {
      if (
        request.method ===
        "POST"
      ) {
        return handleShopApplicationFileUpload(
          request,
          env,
          myApplicationFilesMatch[1]
        );
      }

      return handleMyShopApplicationFiles(
        request,
        env,
        myApplicationFilesMatch[1]
      );
    }

    const myPrivateFileMatch =
      url.pathname.match(
        /^\/api\/me\/shop-application-files\/(\d+)$/
      );

    if (
      myPrivateFileMatch
    ) {
      return handlePrivateShopApplicationFile(
        request,
        env,
        myPrivateFileMatch[1]
      );
    }

    const publicFileMatch =
      url.pathname.match(
        /^\/api\/shop-application-files\/(\d+)$/
      );

    if (
      publicFileMatch
    ) {
      return handlePublicShopApplicationFile(
        request,
        env,
        publicFileMatch[1]
      );
    }

    const myApplicationMatch =
      url.pathname.match(
        /^\/api\/me\/shop-applications\/(\d+)$/
      );

    if (
      myApplicationMatch
    ) {
      return handleMyShopApplicationUpdate(
        request,
        env,
        myApplicationMatch[1]
      );
    }

    if (
      url.pathname ===
      "/api/admin/shop-applications"
    ) {
      return handleAdminShopApplications(
        request,
        env
      );
    }

    const adminApplicationActionMatch =
      url.pathname.match(
        /^\/api\/admin\/shop-applications\/(\d+)\/(needs-more-info|reject|approve)$/
      );

    if (
      adminApplicationActionMatch
    ) {
      return handleAdminShopApplicationAction(
        request,
        env,
        adminApplicationActionMatch[1],
        adminApplicationActionMatch[2]
      );
    }


    // =====================================================
    // BUSINESS
    // =====================================================

    if (
      url.pathname ===
      "/api/business-categories"
    ) {
      return handleBusinessCategories(
        request,
        env
      );
    }

    if (
      url.pathname ===
      "/api/businesses"
    ) {
      return handleBusinesses(
        request,
        env
      );
    }

    if (
      url.pathname ===
      "/api/me/businesses"
    ) {
      return handleMyBusinesses(
        request,
        env
      );
    }

    if (
      url.pathname ===
      "/api/me/saved-businesses"
    ) {
      return handleMySavedBusinesses(
        request,
        env
      );
    }

    const bySlugMatch =
      url.pathname.match(
        /^\/api\/businesses\/by-slug\/([^/]+)$/
      );

    if (
      bySlugMatch
    ) {
      return handleBusinessBySlug(
        request,
        env,
        decodeURIComponent(
          bySlugMatch[1]
        )
      );
    }

    const businessSaveMatch =
      url.pathname.match(
        /^\/api\/businesses\/(\d+)\/save$/
      );

    if (
      businessSaveMatch
    ) {
      return handleBusinessSave(
        request,
        env,
        businessSaveMatch[1]
      );
    }

    const businessReviewsMatch =
      url.pathname.match(
        /^\/api\/businesses\/(\d+)\/reviews$/
      );

    if (
      businessReviewsMatch
    ) {
      return handleBusinessReviews(
        request,
        env,
        businessReviewsMatch[1]
      );
    }

    const reviewReplyMatch =
      url.pathname.match(
        /^\/api\/reviews\/(\d+)\/reply$/
      );

    if (
      reviewReplyMatch
    ) {
      return handleReviewReply(
        request,
        env,
        reviewReplyMatch[1]
      );
    }

    const reviewMatch =
      url.pathname.match(
        /^\/api\/reviews\/(\d+)$/
      );

    if (
      reviewMatch
    ) {
      return handleMyReviewMutation(
        request,
        env,
        reviewMatch[1]
      );
    }

    const myBusinessHoursMatch =
      url.pathname.match(
        /^\/api\/me\/businesses\/(\d+)\/hours$/
      );

    if (
      myBusinessHoursMatch
    ) {
      return handleBusinessHours(
        request,
        env,
        myBusinessHoursMatch[1]
      );
    }

    const myBusinessBenefitsMatch =
      url.pathname.match(
        /^\/api\/me\/businesses\/(\d+)\/benefits$/
      );

    if (
      myBusinessBenefitsMatch
    ) {
      return handleBusinessBenefits(
        request,
        env,
        myBusinessBenefitsMatch[1]
      );
    }

    const myBusinessMatch =
      url.pathname.match(
        /^\/api\/me\/businesses\/(\d+)$/
      );

    if (
      myBusinessMatch
    ) {
      return handleUpdateMyBusiness(
        request,
        env,
        myBusinessMatch[1]
      );
    }

    const businessDetailMatch =
      url.pathname.match(
        /^\/api\/businesses\/(\d+)$/
      );

    if (
      businessDetailMatch
    ) {
      return handleBusinessDetail(
        request,
        env,
        businessDetailMatch[1]
      );
    }


    // =====================================================
    // ADMIN BUSINESS
    // =====================================================

    if (
      url.pathname ===
      "/api/admin/businesses"
    ) {
      return handleAdminBusinessList(
        request,
        env
      );
    }

    const businessApproveMatch =
      url.pathname.match(
        /^\/api\/admin\/businesses\/(\d+)\/approve$/
      );

    if (
      businessApproveMatch
    ) {
      return handleApproveBusiness(
        request,
        env,
        businessApproveMatch[1]
      );
    }


    return new Response(
      "Danjion API Dev",
      {
        headers: {
          "Content-Type":
            "text/plain; charset=UTF-8",
        },
      }
    );
  },
};