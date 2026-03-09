import { RpcSession, RpcTransport, RpcTarget, RpcStub } from "../src/index.js"

interface PatientRecord {
  id: string;
  mrn: string;
  dateOfBirth: string;
  admissionDate: string;
}

interface Diagnosis {
  patientId: string;
  icdCode: string;
  description: string;
  severity: "mild" | "moderate" | "severe" | "critical";
  diagnosedBy: string;
  diagnosedAt: string;
}

interface AnonymizedDiagnosisStats {
  icdCode: string;
  severityDistribution: Record<string, number>;
  count: number;
}

class HospitalDataService extends RpcTarget {
  getAllPatients(): PatientRecord[] { return []; }
  getDiagnosis(patientId: string): Diagnosis | null { return null; }
  anonymize(diagnosis: Diagnosis | null): AnonymizedDiagnosisStats | null { return null; }
}

class TestHarness<T extends RpcTarget> {
  stub: RpcStub<T>;
  constructor(target: T) { this.stub = null!; }
  async [Symbol.asyncDispose]() {}
}

async function testFull() {
  await using harness = new TestHarness(new HospitalDataService());
  using patients = harness.stub.getAllPatients();
  // Test A: simple map — return string
  const testA = await patients.map((patient: PatientRecord) => patient.id);
  testA.length; // works?

  // Test B: map calling one stub method
  const testB = await patients.map((patient: PatientRecord) => {
    return harness.stub.getDiagnosis(patient.id);
  });
  testB.length; // works?

  // Test C: map calling chained stub methods
  const testC = await patients.map((patient: PatientRecord) => {
    const diagnosis = harness.stub.getDiagnosis(patient.id);
    return harness.stub.anonymize(diagnosis);
  });
  testC.length; // works?
  anonymized.length;
  for (const stat of anonymized) {
    if (stat !== null) {
      stat;
    }
  }
}
