import { createAuthClient } from "@neondatabase/auth";

const AUTH_URL =
  "https://ep-old-boat-azi7guqq.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth";

const auth = createAuthClient(AUTH_URL);

// --------------------------------------------------
// 회원가입
// --------------------------------------------------

const signupNameInput = document.querySelector("#signupName");
const signupEmailInput = document.querySelector("#signupEmail");
const signupPasswordInput = document.querySelector("#signupPassword");
const signupButton = document.querySelector("#signupButton");
const signupResult = document.querySelector("#signupResult");

const verifyEmailInput = document.querySelector("#verifyEmail");
const otpCodeInput = document.querySelector("#otpCode");
const resendOtpButton = document.querySelector("#resendOtpButton");
const verifyButton = document.querySelector("#verifyButton");
const verifyResult = document.querySelector("#verifyResult");

// --------------------------------------------------
// 로그인
// --------------------------------------------------

const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const loginButton = document.querySelector("#loginButton");
const logoutButton = document.querySelector("#logoutButton");
const result = document.querySelector("#result");

// --------------------------------------------------
// 주민인증
// --------------------------------------------------

const buildingInput = document.querySelector("#building");
const unitInput = document.querySelector("#unit");
const verificationButton = document.querySelector("#verificationButton");
const verificationResult = document.querySelector("#verificationResult");

// --------------------------------------------------
// 관리자 승인
// --------------------------------------------------

const verificationIdInput = document.querySelector("#verificationId");
const approveButton = document.querySelector("#approveButton");
const approveResult = document.querySelector("#approveResult");

let currentJwt = null;

// --------------------------------------------------
// 새 계정 가입
// --------------------------------------------------

signupButton.addEventListener("click", async () => {
  signupResult.textContent = "새 계정 만드는 중...";

  try {
    const name = signupNameInput.value.trim();
    const email = signupEmailInput.value.trim();
    const password = signupPasswordInput.value;

    if (!name || !email || !password) {
      throw new Error("이름, 이메일, 비밀번호를 모두 입력하세요.");
    }

    const signupResponse = await auth.signUp.email({
      name,
      email,
      password,
      callbackURL: window.location.origin,
    });

    if (signupResponse?.error) {
      throw signupResponse.error;
    }

    // 인증 이메일 칸에 자동으로 같은 이메일 복사
    verifyEmailInput.value = email;

    signupResult.textContent = JSON.stringify(
      {
        signup_ok: true,
        email: email,
        next: "이메일에서 인증코드를 확인하세요.",
      },
      null,
      2
    );
  } catch (error) {
    signupResult.textContent = JSON.stringify(
      {
        signup_ok: false,
        error: error?.message ?? String(error),
        code: error?.code ?? null,
        status: error?.status ?? null,
      },
      null,
      2
    );
  }
});

// --------------------------------------------------
// 인증코드 다시 보내기
// --------------------------------------------------

resendOtpButton.addEventListener("click", async () => {
  verifyResult.textContent = "인증코드 보내는 중...";

  try {
    const email = verifyEmailInput.value.trim();

    if (!email) {
      throw new Error("인증할 이메일을 입력하세요.");
    }

    const otpResponse =
      await auth.emailOtp.sendVerificationOtp({
        email,
        type: "email-verification",
      });

    if (otpResponse?.error) {
      throw otpResponse.error;
    }

    verifyResult.textContent = JSON.stringify(
      {
        otp_sent: true,
        next: "이메일로 받은 인증코드를 입력하세요.",
      },
      null,
      2
    );
  } catch (error) {
    verifyResult.textContent = JSON.stringify(
      {
        otp_sent: false,
        error: error?.message ?? String(error),
        code: error?.code ?? null,
        status: error?.status ?? null,
      },
      null,
      2
    );
  }
});

// --------------------------------------------------
// 인증코드 확인
// --------------------------------------------------

verifyButton.addEventListener("click", async () => {
  verifyResult.textContent = "인증코드 확인 중...";

  try {
    const email = verifyEmailInput.value.trim();
    const otp = otpCodeInput.value.trim();

    if (!email || !otp) {
      throw new Error("이메일과 인증코드를 모두 입력하세요.");
    }

    const verifyResponse =
      await auth.emailOtp.verifyEmail({
        email,
        otp,
      });

    if (verifyResponse?.error) {
      throw verifyResponse.error;
    }

    // 로그인 칸에도 자동 복사
    emailInput.value = email;

    verifyResult.textContent = JSON.stringify(
      {
        email_verified: true,
        next: "아래 로그인 테스트에서 새 계정으로 로그인하세요.",
      },
      null,
      2
    );
  } catch (error) {
    verifyResult.textContent = JSON.stringify(
      {
        email_verified: false,
        error: error?.message ?? String(error),
        code: error?.code ?? null,
        status: error?.status ?? null,
      },
      null,
      2
    );
  }
});

// --------------------------------------------------
// 로그인
// --------------------------------------------------

loginButton.addEventListener("click", async () => {
  let stage = "signIn";

  result.textContent = "로그인 확인 중...";
  verificationResult.textContent = "";
  approveResult.textContent = "";

  verificationButton.disabled = true;
  approveButton.disabled = true;
  currentJwt = null;

  try {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    const loginResult = await auth.signIn.email({
      email,
      password,
    });

    if (loginResult?.error) {
      throw loginResult.error;
    }

    stage = "getSession";

    const sessionResult = await auth.getSession();
    const session = sessionResult?.data ?? sessionResult;

    const jwt = session?.session?.token ?? null;

    if (!jwt || jwt.split(".").length !== 3) {
      throw new Error("JWT를 가져오지 못했습니다.");
    }

    currentJwt = jwt;

    stage = "apiMe";

    const meResponse = await fetch("/api/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${currentJwt}`,
      },
    });

    const me = await meResponse.json();

    if (!meResponse.ok) {
      throw new Error(
        me?.error || `API /me 실패: HTTP ${meResponse.status}`
      );
    }

    verificationButton.disabled = false;
    approveButton.disabled = false;

    result.textContent = JSON.stringify(
      {
        login_ok: true,
        email_verified: session?.user?.emailVerified ?? null,
        jwt_present: true,
        jwt_format_ok: true,
        api_me_ok: me?.ok ?? false,
        danjion_user_id: me?.data?.user?.id ?? null,
        account_status: me?.data?.user?.account_status ?? null,
      },
      null,
      2
    );
  } catch (error) {
    result.textContent = JSON.stringify(
      {
        login_ok: false,
        failed_stage: stage,
        error: error?.message ?? String(error),
        code: error?.code ?? null,
        status: error?.status ?? null,
      },
      null,
      2
    );
  }
});

// --------------------------------------------------
// 로그아웃
// --------------------------------------------------

logoutButton.addEventListener("click", async () => {
  result.textContent = "로그아웃 중...";

  try {
    const logoutResult = await auth.signOut();

    if (logoutResult?.error) {
      throw logoutResult.error;
    }

    currentJwt = null;
    verificationButton.disabled = true;
    approveButton.disabled = true;

    result.textContent = JSON.stringify(
      {
        logout_ok: true,
      },
      null,
      2
    );
  } catch (error) {
    result.textContent = JSON.stringify(
      {
        logout_ok: false,
        error: error?.message ?? String(error),
      },
      null,
      2
    );
  }
});

// --------------------------------------------------
// 주민인증 신청
// --------------------------------------------------

verificationButton.addEventListener("click", async () => {
  verificationResult.textContent = "주민인증 신청 중...";

  try {
    if (!currentJwt) {
      throw new Error("먼저 로그인해야 합니다.");
    }

    const response = await fetch("/api/resident-verifications", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${currentJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        building_label: buildingInput.value.trim(),
        unit_number: unitInput.value.trim(),
      }),
    });

    const data = await response.json();

    verificationResult.textContent = JSON.stringify(
      {
        http_status: response.status,
        ...data,
      },
      null,
      2
    );
  } catch (error) {
    verificationResult.textContent = JSON.stringify(
      {
        ok: false,
        error: error?.message ?? String(error),
      },
      null,
      2
    );
  }
});

// --------------------------------------------------
// 관리자 승인
// --------------------------------------------------

approveButton.addEventListener("click", async () => {
  approveResult.textContent = "관리자 승인 요청 중...";

  try {
    if (!currentJwt) {
      throw new Error("먼저 로그인해야 합니다.");
    }

    const verificationId = verificationIdInput.value.trim();

    const response = await fetch(
      `/api/admin/resident-verifications/${verificationId}/approve`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${currentJwt}`,
        },
      }
    );

    const data = await response.json();

    approveResult.textContent = JSON.stringify(
      {
        http_status: response.status,
        ...data,
      },
      null,
      2
    );
  } catch (error) {
    approveResult.textContent = JSON.stringify(
      {
        ok: false,
        error: error?.message ?? String(error),
      },
      null,
      2
    );
  }
});