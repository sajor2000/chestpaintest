"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * SMART on FHIR EHR Launch page — scaffold for future Epic integration.
 *
 * When embedded in Epic Hyperspace, this page receives `iss` and `launch`
 * query params. It initiates the OAuth2 authorization flow via fhirclient,
 * then redirects to the main chat page with an authenticated FHIR client.
 *
 * Phase 2 will:
 * 1. Call FHIR.oauth2.authorize() with Epic client_id and scopes
 * 2. Redirect to / where FHIR.oauth2.ready() completes auth
 * 3. Auto-pull Patient (sex, age), Observation (hs-TnI via LOINC 89579-7),
 *    Condition (ESRD), and DiagnosticReport (EKG) from the chart
 */
export default function SmartLaunch() {
  useEffect(() => {
    // Phase 2: uncomment and configure with your Epic client_id
    //
    // After adding the Phase 2 fhirclient dependency:
    // import("fhirclient").then(({ default: FHIR }) => {
    //   FHIR.oauth2.authorize({
    //     clientId: process.env.NEXT_PUBLIC_EPIC_CLIENT_ID!,
    //     scope: "launch patient/Patient.read patient/Observation.read patient/Condition.read patient/DiagnosticReport.read openid profile",
    //     redirectUri: window.location.origin + "/",
    //   });
    // });
  }, []);

  return (
    <div className="flex items-center justify-center h-dvh bg-white">
      <div className="text-center space-y-4 px-6">
        <div className="w-12 h-12 rounded-xl bg-[#003366] text-white flex items-center justify-center text-lg font-bold mx-auto">
          R
        </div>
        <h1 className="text-xl font-semibold text-slate-800">
          SMART on FHIR Launch
        </h1>
        <p className="text-sm text-slate-500 max-w-sm">
          This page handles the EHR launch flow when embedded in Epic
          Hyperspace. It is a scaffold for Phase 2 integration.
        </p>
        <div className="pt-2">
          <Link
            href="/"
            className="inline-block px-4 py-2 bg-[#003366] text-white text-sm rounded-lg hover:bg-[#002244] transition-colors"
          >
            Open Standalone Chat
          </Link>
        </div>
      </div>
    </div>
  );
}
