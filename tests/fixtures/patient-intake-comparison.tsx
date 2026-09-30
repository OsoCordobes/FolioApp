import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { PatientIntakeControl } from "../../components/calendario/patient-intake-control";
import "./patient-intake-comparison-staff";
import "../../styles/experience.css";
import "../../styles/platform.css";
import "../../styles/clinical-experience.css";
import "../../styles/auth-experience.css";
import "../../styles/onboarding-experience.css";
import "../../styles/profile-editor.css";
import "../../styles/public-experience.css";

function Fixture() {
  const [open, setOpen] = useState(true);
  const [turno, setTurno] = useState("33333333-3333-4333-8333-333333333333");
  window.reopenFixture = () => setOpen(true);
  window.closeFixture = () => setOpen(false);
  window.changeTurnoFixture = setTurno;
  return <main style={{ maxWidth: 920, margin: "24px auto", padding: 16 }}>
    <p>Ensayo sintético · sin backend · ningún dato real</p>
    {open ? <PatientIntakeControl turnoId={turno} incorporationEnabled /> : <p>Vista cerrada</p>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
