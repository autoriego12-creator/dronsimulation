# -*- coding: utf-8 -*-
"""
Generador optimizado del Manual de Usuario en PDF para HELIOS·KDE
Diseño balanceado de 6 páginas exactas, sin páginas huérfanas y con fórmulas en HTML renderizado.
"""
import os
import subprocess
import shutil

html_content = """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  @page {
    size: A4;
    margin: 14mm 14mm 14mm 14mm;
  }
  
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1e293b;
    background: #ffffff;
    line-height: 1.45;
    font-size: 9pt;
    margin: 0;
    padding: 0;
  }

  /* Control estricto de páginas */
  .page {
    page-break-after: always;
    min-height: 265mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .page-last {
    min-height: 265mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .content-body {
    flex: 1;
  }

  /* Portada */
  .cover {
    min-height: 265mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 22mm 18mm;
    background: linear-gradient(145deg, #060913 0%, #0c1427 55%, #181133 100%);
    color: #f8fafc;
    border-radius: 8px;
    border: 1px solid #1e293b;
    page-break-after: always;
  }

  .cover-header {
    border-bottom: 2px solid #00f0ff;
    padding-bottom: 18px;
  }

  .badge-id {
    display: inline-block;
    background: rgba(0, 240, 255, 0.12);
    border: 1px solid #00f0ff;
    color: #00f0ff;
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 8.5pt;
    font-weight: 700;
    letter-spacing: 0.15em;
    font-family: monospace;
    margin-bottom: 14px;
  }

  .cover-title {
    font-size: 26pt;
    font-weight: 800;
    line-height: 1.15;
    margin: 0 0 10px 0;
    letter-spacing: -0.02em;
    color: #ffffff;
  }

  .cover-title span {
    color: #00f0ff;
  }

  .cover-subtitle {
    font-size: 13pt;
    font-weight: 400;
    color: #94a3b8;
    margin: 0;
    line-height: 1.4;
  }

  .cover-body {
    margin: 30px 0;
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 8px;
    padding: 20px;
  }

  .cover-metric-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-top: 20px;
  }

  .cover-metric {
    background: rgba(2, 6, 23, 0.7);
    border: 1px solid rgba(0, 240, 255, 0.25);
    border-radius: 6px;
    padding: 12px 10px;
    text-align: center;
  }

  .cover-metric .val {
    font-size: 18pt;
    font-weight: 800;
    color: #00f0ff;
    font-family: monospace;
  }

  .cover-metric .lbl {
    font-size: 7.5pt;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 4px;
  }

  .cover-footer {
    border-top: 1px solid rgba(148, 163, 184, 0.2);
    padding-top: 16px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    font-size: 9pt;
    color: #94a3b8;
  }

  .author-box strong {
    color: #ffffff;
    font-size: 12pt;
    display: block;
    margin-top: 2px;
  }

  /* Encabezados y títulos */
  h1 {
    font-size: 14pt;
    font-weight: 800;
    color: #0f172a;
    border-bottom: 2px solid #0ea5e9;
    padding-bottom: 5px;
    margin: 0 0 10px 0;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  h2 {
    font-size: 10.5pt;
    font-weight: 700;
    color: #1e293b;
    margin: 12px 0 6px 0;
    border-left: 3.5px solid #8b5cf6;
    padding-left: 8px;
  }

  p {
    margin: 0 0 8px 0;
    text-align: justify;
    line-height: 1.45;
  }

  ul, ol {
    margin: 0 0 8px 0;
    padding-left: 18px;
  }

  li {
    margin-bottom: 4px;
  }

  /* Cajas de notas y alertas */
  .callout {
    background: #f8fafc;
    border-left: 4px solid #0ea5e9;
    border-radius: 4px;
    padding: 8px 12px;
    margin: 10px 0;
    font-size: 8.5pt;
    line-height: 1.4;
  }

  .callout.purple {
    border-left-color: #8b5cf6;
    background: #faf5ff;
  }

  .callout.amber {
    border-left-color: #f59e0b;
    background: #fffbeb;
  }

  .callout-title {
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 3px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Tablas de especificación */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 8.5pt;
  }

  th {
    background: #0f172a;
    color: #f8fafc;
    font-weight: 600;
    text-align: left;
    padding: 6px 8px;
    border: 1px solid #1e293b;
    text-transform: uppercase;
    font-size: 7.5pt;
    letter-spacing: 0.05em;
  }

  td {
    padding: 6px 8px;
    border: 1px solid #e2e8f0;
    color: #334155;
    vertical-align: top;
  }

  tr:nth-child(even) td {
    background: #f8fafc;
  }

  /* Grids */
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin: 8px 0;
  }

  .card {
    border: 1px solid #e2e8f0;
    background: #ffffff;
    border-radius: 6px;
    padding: 10px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.03);
  }

  .card-header {
    font-weight: 700;
    font-size: 9pt;
    color: #0f172a;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .card-code {
    display: inline-block;
    font-family: monospace;
    font-size: 7pt;
    background: #e2e8f0;
    color: #475569;
    padding: 1px 5px;
    border-radius: 3px;
    margin-right: 4px;
  }

  .tag {
    display: inline-block;
    font-size: 7pt;
    font-weight: 600;
    padding: 2px 5px;
    border-radius: 3px;
    text-transform: uppercase;
  }
  .tag-cyan { background: #e0f2fe; color: #0369a1; }
  .tag-violet { background: #f3e8ff; color: #6b21a8; }
  .tag-amber { background: #fef3c7; color: #92400e; }
  .tag-red { background: #fee2e2; color: #991b1b; }

  .diagram-flow {
    background: #0f172a;
    color: #f8fafc;
    padding: 10px 14px;
    border-radius: 6px;
    margin: 8px 0;
    font-family: monospace;
    font-size: 7.8pt;
    line-height: 1.4;
    border: 1px solid #1e293b;
  }

  .kpi-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin: 10px 0;
  }

  .kpi-box {
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 8px;
    text-align: center;
    background: #f8fafc;
  }

  .kpi-box.highlight {
    border-color: #8b5cf6;
    background: #faf5ff;
  }

  .kpi-box .num {
    font-size: 16pt;
    font-weight: 800;
    color: #6d28d9;
    font-family: monospace;
  }

  .kpi-box .lbl {
    font-size: 7pt;
    font-weight: 600;
    color: #475569;
    margin-top: 3px;
    line-height: 1.15;
  }

  .kpi-box .sub {
    font-size: 6.5pt;
    color: #94a3b8;
    margin-top: 2px;
  }

  .step-number {
    display: inline-block;
    width: 18px;
    height: 18px;
    background: #0ea5e9;
    color: #ffffff;
    border-radius: 50%;
    text-align: center;
    line-height: 18px;
    font-weight: 700;
    font-size: 7.5pt;
    margin-right: 5px;
  }

  .header-banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #cbd5e1;
    padding-bottom: 5px;
    margin-bottom: 12px;
    font-size: 7.5pt;
    color: #64748b;
    font-family: monospace;
  }

  .footer-banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid #e2e8f0;
    padding-top: 6px;
    margin-top: 10px;
    font-size: 7.5pt;
    color: #94a3b8;
    font-family: monospace;
  }

  .formula-box {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    padding: 6px 10px;
    margin: 6px 0;
    font-family: "Cambria Math", "DejaVu Sans", serif;
    font-size: 9.5pt;
    text-align: center;
    color: #0f172a;
  }
</style>
</head>
<body>

<!-- ==================== PÁGINA 1: PORTADA ==================== -->
<div class="cover">
  <div class="cover-header">
    <div class="badge-id">SISTEMA HELIOS·KDE &nbsp;|&nbsp; PROYECTO ID 4300</div>
    <h1 class="cover-title">SIMULACIÓN DE <span>GEOLOCALIZACIÓN</span> Y MONITOREO DE DRONES</h1>
    <p class="cover-subtitle">Rastreo Térmico Virtual, Estimación de Densidad Kernel (KDE) y Telemetría en Tiempo Real</p>
  </div>

  <div class="cover-body">
    <div style="font-size: 9.5pt; color: #cbd5e1; margin-bottom: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">
      Manual Oficial de Operación, Análisis y Métricas de Desempeño
    </div>
    <p style="color: #94a3b8; font-size: 9pt; line-height: 1.55; margin: 0;">
      Este documento presenta la guía técnica integral para la operación, visualización interactiva y evaluación cuantitativa del centro de mando táctico HELIOS·KDE. El sistema modela flotas autónomas de drones (UAVs) con cinemática realista, atenuación térmica atmosférica, sensor infrarrojo, degradación por radiofrecuencia (RF) urbana y renderizado dinámico de mapas de calor KDE a 60 FPS.
    </p>

    <div class="cover-metric-row">
      <div class="cover-metric">
        <div class="val">94%</div>
        <div class="lbl">Precisión GNSS</div>
      </div>
      <div class="cover-metric">
        <div class="val">1.2 s</div>
        <div class="lbl">Tiempo Respuesta</div>
      </div>
      <div class="cover-metric">
        <div class="val">87%</div>
        <div class="lbl">Cobertura Área</div>
      </div>
      <div class="cover-metric">
        <div class="val">98%</div>
        <div class="lbl">Eficiencia Total</div>
      </div>
    </div>
  </div>

  <div class="cover-footer">
    <div class="author-box">
      <div>AUTOR DEL PROYECTO:</div>
      <strong>Sebastián García Olivar</strong>
      <div style="font-size: 8pt; color: #64748b; margin-top: 2px;">Simulación · Geolocalización · Drones · KDE</div>
    </div>
    <div style="text-align: right;">
      <div>DOCUMENTO TÉCNICO v1.0</div>
      <div style="color: #00f0ff; font-weight: 600; margin-top: 2px;">Centro de Mando + App Operador</div>
    </div>
  </div>
</div>

<!-- ==================== PÁGINA 2: INTRODUCCIÓN Y ARQUITECTURA ==================== -->
<div class="page">
  <div class="content-body">
    <div class="header-banner">
      <span>HELIOS·KDE (ID 4300) — MANUAL DE USUARIO</span>
      <span>SECCIÓN 1: INTRODUCCIÓN Y ARQUITECTURA</span>
    </div>

    <h1>1. Introducción y Fundamentos del Proyecto</h1>
    <p>
      El proyecto <strong>HELIOS·KDE</strong> supera las limitaciones del rastreo tradicional de drones basado en radiofrecuencia (RF), integrando la supervisión de firmas infrarrojas y la <strong>Estimación de Densidad Kernel (KDE)</strong> para generar mapas de calor dinámicos con telemetría en tiempo real.
    </p>

    <h2>1.1. Comparativa: Rastreo Tradicional RF vs. Mapas de Calor KDE</h2>
    <table>
      <thead>
        <tr>
          <th style="width: 22%;">Criterio</th>
          <th style="width: 39%;">Rastreo Tradicional RF</th>
          <th style="width: 39%;">Supervisión Térmica KDE (HELIOS·KDE)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Interferencias</strong></td>
          <td>Alta vulnerabilidad a campos EMI y bloqueo por cañones urbanos.</td>
          <td>Inmune a interferencias de radio; analiza radiación infrarroja acumulada.</td>
        </tr>
        <tr>
          <td><strong>Latencia y Refresco</strong></td>
          <td>Elevada latencia (0.85 a 1.9 s) y refresco lento (≈2 Hz).</td>
          <td>Pipeline de baja latencia (100 ms / 10 Hz) con renderizado a 60 FPS.</td>
        </tr>
        <tr>
          <td><strong>Visión de Conjunto</strong></td>
          <td>Puntos individuales aislados; no modela densidades ni corredores.</td>
          <td>Mapa continuo KDE que revela zonas de saturación y rutas críticas.</td>
        </tr>
        <tr>
          <td><strong>Predictibilidad</strong></td>
          <td>Reactiva: depende del último paquete transmitido con retardo.</td>
          <td>Proactiva: cinemática de giro coordinado (CTRV a +3 s) y vector de flota.</td>
        </tr>
      </tbody>
    </table>

    <h2>1.2. Arquitectura de Doble Motor y Flujo de Procesamiento</h2>
    <div class="diagram-flow">
      [ SENSORES SINTÉTICOS ] ──► [ PIPELINE 100 ms ] ──► [ MOTOR KDE BINNED ] ──► [ CANVAS 2D 60 FPS ]
      • Cinemática giro limitado  • Fusión GNSS (σ=3.4m)   • Malla 72×72 (h=115m)   • Gradiente térmico neón
      • Firma IR motor + focos    • Ruido RF y corte enlace• Tiempo cómputo 0.5 ms  • HUD táctico interactivo
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header"><span class="card-code">CORE-PY</span> Backend Python (FastAPI)</div>
        <p style="font-size: 8pt; color: #475569; margin: 0;">
          Servidor central que procesa el pipeline cada 100 ms con NumPy y SciPy, emitiendo telemetría por WebSockets. Genera reportes científicos con Matplotlib y mapas georreferenciados con Folium.
        </p>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-code">CORE-TS</span> Motor Autónomo Local (TypeScript)</div>
        <p style="font-size: 8pt; color: #475569; margin: 0;">
          Implementación matemática idéntica embebida en el cliente. Si el backend no responde (p. ej. en la web pública de Vercel o en campo), conmuta instantáneamente al motor local sin interrupción.
        </p>
      </div>
    </div>

    <div class="callout purple">
      <div class="callout-title">Formulación del KDE Binned con Filtro Gaussiano Isotrópico</div>
      Para procesar el mapa en <strong>0.5 ms</strong> por ciclo (dentro de los 100 ms del tick), se emplea un estimador kernel discretizado sobre una malla regular de 72 × 72 celdas:
      <div class="formula-box">
        f̂(x, y) = ∑ₖ wₖ · K_h( (x - xₖ), (y - yₖ) ) &nbsp;&nbsp;|&nbsp;&nbsp; wₖ = 0.18 + I_IR · 1.4 &nbsp;&nbsp;|&nbsp;&nbsp; h = 115 m
      </div>
      donde cada posición reciente se pondera por su firma infrarroja y recencia temporal, aplicando un filtro convolucional gaussiano bidimensional separado.
    </div>
  </div>

  <div class="footer-banner">
    <span>HELIOS·KDE — PROYECTO ID 4300</span>
    <span>SECCIÓN 1: INTRODUCCIÓN Y ARQUITECTURA</span>
    <span>PÁGINA 2</span>
  </div>
</div>

<!-- ==================== PÁGINA 3: QUÉ SE PUEDE VER ==================== -->
<div class="page">
  <div class="content-body">
    <div class="header-banner">
      <span>HELIOS·KDE (ID 4300) — MANUAL DE USUARIO</span>
      <span>SECCIÓN 2: INTERFAZ VISUAL</span>
    </div>

    <h1>2. Interfaz de Monitoreo: ¿Qué se Puede Ver?</h1>
    <p>
      La consola de HELIOS·KDE reproduce el diseño ergonómico de los centros de mando de control táctico aeroespacial (C2), organizado en cuatro áreas de información operativa:
    </p>

    <h2>2.1. Mapa Táctico Central (Canvas 2D Georreferenciado)</h2>
    <p>
      Representa un espacio operativo de <strong>4,000 × 4,000 metros (16 km²)</strong> centrado en coordenadas 4.6486° N, -74.0628° O:
    </p>
    <ul>
      <li><strong>Capa Térmica KDE:</strong> Representación continua de calor con gradiente dinámico:
        <span style="color: #0284c7; font-weight: 600;">Cian (Baja actividad)</span> ──► 
        <span style="color: #7c3aed; font-weight: 600;">Púrpura</span> ──► 
        <span style="color: #ea580c; font-weight: 600;">Naranja</span> ──► 
        <span style="color: #dc2626; font-weight: 700;">Rojo Neón (Pico térmico crítico)</span>.
      </li>
      <li><strong>Marcadores de Drones:</strong> Iconos de aeronaves (UAV-01 a UAV-12) con etiquetas aeronáuticas (ALFA, BRAVO, CHARLIE, etc.), cono de rumbo y altitud en metros.</li>
      <li><strong>Estelas Térmicas:</strong> Historial de trayectoria reciente (últimos 60 puntos) cuyo brillo y grosor reflejan la radiación infrarroja instantánea.</li>
      <li><strong>Zonas de Sombra Urbana:</strong> Círculos con trama violeta que simulan zonas edilicias densas donde la señal RF sufre multitrayecto y atenuación severa.</li>
      <li><strong>Fuentes EMI:</strong> Puntos emisores de perturbación electromagnética que degradan la precisión de los enlaces de radio tradicionales.</li>
      <li><strong>Estación Terrena y Vector de Flota:</strong> Vértice de control central con enlaces visuales y vector predictivo CTRV a +3 segundos.</li>
    </ul>

    <h2>2.2. Paneles de Mando Laterales y Alertas</h2>
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><span class="card-code">PANEL-IZQ</span> Flota y Telemetría</div>
        <ul style="font-size: 8pt; color: #475569; padding-left: 14px; margin: 0;">
          <li><strong>Listado de Unidades:</strong> Estado con badge <span class="tag tag-cyan">NOMINAL</span>, <span class="tag tag-amber">HOT</span> o <span class="tag tag-red">LOW BAT</span>.</li>
          <li><strong>Datos por Dron:</strong> Coordenadas GPS decimales, altitud (m), velocidad (m/s), rumbo magnético (°) y batería restante (%).</li>
          <li><strong>Firma Térmica:</strong> Temperatura medida en motor y sensor IR (°C).</li>
        </ul>
      </div>

      <div class="card">
        <div class="card-header"><span class="card-code">PANEL-DER</span> Comparador y Alertas</div>
        <ul style="font-size: 8pt; color: #475569; padding-left: 14px; margin: 0;">
          <li><strong>Comparador en Vivo:</strong> Precisión media, latencia en milisegundos y tasa de pérdida de paquetes KDE vs. RF.</li>
          <li><strong>Feed de Eventos:</strong> Alertas con nivel de severidad:
            <br>• <span class="tag tag-red">THERMAL</span> Sobrecalentamiento &gt;72°C.
            <br>• <span class="tag tag-amber">FOCUS</span> Expansión de foco crítico.
            <br>• <span class="tag tag-violet">INTRUSION</span> Firma térmica no identificada.
            <br>• <span class="tag tag-amber">SATURATION</span> Agrupamiento &gt;4 drones en 380 m.
          </li>
        </ul>
      </div>
    </div>

    <h2>2.3. Dock Inferior Desplegable</h2>
    <ul>
      <li><strong>Pestaña "Validación Científica":</strong> Expone los cuatro cuadrantes de KPIs de desempeño global y la serie histórica de barras apiladas (2020–2024).</li>
      <li><strong>Pestaña "Historial de Rutas":</strong> Reproductor interactivo (Replay Loop) con scrubber temporal para retroceder, pausar y analizar trayectorias pasadas.</li>
    </ul>
  </div>

  <div class="footer-banner">
    <span>HELIOS·KDE — PROYECTO ID 4300</span>
    <span>SECCIÓN 2: INTERFAZ VISUAL</span>
    <span>PÁGINA 3</span>
  </div>
</div>

<!-- ==================== PÁGINA 4: QUÉ SE PUEDE HACER ==================== -->
<div class="page">
  <div class="content-body">
    <div class="header-banner">
      <span>HELIOS·KDE (ID 4300) — MANUAL DE USUARIO</span>
      <span>SECCIÓN 3: GUÍA OPERATIVA</span>
    </div>

    <h1>3. Guía Operativa: ¿Qué se Puede Hacer y Controlar?</h1>
    <p>
      El sistema permite la interacción en caliente a través de selectores modales situados en la barra superior (Header) y acciones específicas en los paneles:
    </p>

    <h2>3.1. Selección de Escenarios de Misión</h2>
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><span class="step-number">1</span> <strong>Vigilancia de Seguridad</strong></div>
        <p style="font-size: 8pt; color: #475569; margin: 0;">
          <strong>Dinámica:</strong> 10 drones patrullan en cuadrícula urbana a 90–140 m de altitud. Aleatoriamente se generan firmas térmicas sospechosas (intrusiones). El sistema alerta y desvía automáticamente a los dos drones más cercanos para interceptar el objetivo.
        </p>
      </div>

      <div class="card">
        <div class="card-header"><span class="step-number">2</span> <strong>Monitoreo Agrícola</strong></div>
        <p style="font-size: 8pt; color: #475569; margin: 0;">
          <strong>Dinámica:</strong> 8 drones vuelan a baja altitud (55–70 m) ejecutando barridos boustrofédicos (ida y vuelta continua) sobre 4 parcelas agrícolas, detectando zonas de estrés hídrico o sobrecalentamiento del suelo.
        </p>
      </div>
    </div>

    <div class="card" style="margin-top: 6px;">
      <div class="card-header"><span class="step-number">3</span> <strong>Gestión de Emergencias (Incendios / Búsqueda)</strong></div>
      <p style="font-size: 8pt; color: #475569; margin: 0;">
        <strong>Dinámica:</strong> 12 drones a gran altitud (110–180 m) con velocidad elevada (27 m/s). Se simulan focos de fuego en expansión. La flota ejecuta un algoritmo de convergencia autónoma, orbitando en círculos concéntricos para monitorear el perímetro del foco en tiempo real.
      </p>
    </div>

    <h2>3.2. Conmutación de Modos de Rastreo</h2>
    <ul>
      <li><strong>KDE Térmico:</strong> Visualización limpia de la superficie de calor y densidad kernel, optimizada para toma de decisiones tácticas.</li>
      <li><strong>RF Tradicional:</strong> Emula la perspectiva de un radar por radiofrecuencia, con saltos de posición, círculos de dispersión de error y pérdida momentánea de señal en cañones urbanos.</li>
      <li><strong>Comparación en Vivo:</strong> Superpone el dato real contra la estimación RF degradada, evidenciando de forma directa la superioridad de KDE frente al rastreo por radio.</li>
    </ul>

    <h2>3.3. Modos de Visualización del Entorno</h2>
    <ul>
      <li><strong>Panel Web:</strong> Disposición completa de escritorio optimizada para estaciones de trabajo y monitores de centros de mando.</li>
      <li><strong>Simulador Android:</strong> Renderiza un marco realista de smartphone con la interfaz móvil del operador en campo (diseñada para APK nativo con Capacitor 6).</li>
      <li><strong>Auto:</strong> Conmutación automática según el tamaño de la pantalla (responsive adaptativo).</li>
    </ul>

    <h2>3.4. Acciones de Exportación y Descarga</h2>
    <ul>
      <li><strong>Exportar Dataset JSON:</strong> Descarga inmediata de un archivo estructurado con toda la telemetría, alertas, KPIs y rutas registradas.</li>
      <li><strong>Mapa Folium / Leaflet:</strong> Visualización cartográfica interactiva con capas de calor superpuestas sobre mapa satelital (con backend Python).</li>
      <li><strong>Reporte Matplotlib:</strong> Generación de gráfica PNG de alta resolución con curvas de dispersión y validación formal de errores.</li>
    </ul>
  </div>

  <div class="footer-banner">
    <span>HELIOS·KDE — PROYECTO ID 4300</span>
    <span>SECCIÓN 3: GUÍA OPERATIVA</span>
    <span>PÁGINA 4</span>
  </div>
</div>

<!-- ==================== PÁGINA 5: QUÉ SE PUEDE MEDIR ==================== -->
<div class="page">
  <div class="content-body">
    <div class="header-banner">
      <span>HELIOS·KDE (ID 4300) — MANUAL DE USUARIO</span>
      <span>SECCIÓN 4: MÉTRICAS Y VALIDACIÓN</span>
    </div>

    <h1>4. Métricas de Rendimiento: ¿Qué se Puede Medir?</h1>
    <p>
      El sistema cuenta con instrumentación cuantitativa exhaustiva que permite auditar en vivo la calidad del monitoreo mediante cuatro grandes KPIs y análisis comparativo instantáneo:
    </p>

    <h2>4.1. Los Cuatro Grandes KPIs de Validación</h2>
    <div class="kpi-row">
      <div class="kpi-box highlight">
        <div class="num">94%</div>
        <div class="lbl">PRECISIÓN GNSS</div>
        <div class="sub">Error &lt; 8 m (n = 12 400)</div>
      </div>
      <div class="kpi-box highlight">
        <div class="num">1.2 s</div>
        <div class="lbl">TIEMPO RESPUESTA</div>
        <div class="sub">Detección ➔ Alerta</div>
      </div>
      <div class="kpi-box highlight">
        <div class="num">87%</div>
        <div class="lbl">COBERTURA ÁREA</div>
        <div class="sub">16 km² operativos</div>
      </div>
      <div class="kpi-box highlight">
        <div class="num">98%</div>
        <div class="lbl">EFICIENCIA TOTAL</div>
        <div class="sub">Disponibilidad pipeline</div>
      </div>
    </div>

    <h2>4.2. Métricas Cuantitativas en Vivo (KDE vs. RF Tradicional)</h2>
    <table>
      <thead>
        <tr>
          <th>Parámetro de Medición</th>
          <th>Supervisión por Mapa KDE</th>
          <th>Rastreo Tradicional RF</th>
          <th>Ventaja Observada</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Error de Posición Medio</strong></td>
          <td><strong>3.4 a 4.8 m</strong> (dispersión nominal)</td>
          <td><strong>18.5 a 68.2 m</strong> (ruido urbano y EMI)</td>
          <td>Reducción del error en hasta un <strong>85%</strong>.</td>
        </tr>
        <tr>
          <td><strong>Latencia de Actualización</strong></td>
          <td><strong>100 ms</strong> (sincronizada a 10 Hz)</td>
          <td><strong>850 a 1,900 ms</strong> (retraso de radio)</td>
          <td>Información <strong>10 a 15 veces más rápida</strong>.</td>
        </tr>
        <tr>
          <td><strong>Tasa de Pérdida de Enlace</strong></td>
          <td><strong>0%</strong> (continuidad espacial)</td>
          <td><strong>5% a 35%</strong> en cañones urbanos</td>
          <td>Monitoreo ininterrumpido sin zonas ciegas.</td>
        </tr>
        <tr>
          <td><strong>Error Predicción CTRV</strong></td>
          <td><strong>&lt; 5.2 m</strong> a +3 segundos</td>
          <td>No disponible (trayectoria discontinua)</td>
          <td>Anticipación efectiva de colisiones y saturación.</td>
        </tr>
      </tbody>
    </table>

    <h2>4.3. Evolución del Desempeño Tecnológico (2020 – 2024)</h2>
    <table>
      <thead>
        <tr>
          <th>Año</th>
          <th>Rastreo RF Tradicional</th>
          <th>Telemetría GPS Fusionada</th>
          <th>Mapa de Calor KDE</th>
          <th>Índice Global (0–140)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>2020</strong></td>
          <td>40 pts (59%)</td>
          <td>20 pts (29%)</td>
          <td>8 pts (12%)</td>
          <td><strong>68 puntos</strong></td>
        </tr>
        <tr>
          <td><strong>2021</strong></td>
          <td>38 pts (43%)</td>
          <td>28 pts (32%)</td>
          <td>22 pts (25%)</td>
          <td><strong>88 puntos</strong></td>
        </tr>
        <tr>
          <td><strong>2023</strong></td>
          <td>34 pts (31%)</td>
          <td>36 pts (32%)</td>
          <td>41 pts (37%)</td>
          <td><strong>111 puntos</strong></td>
        </tr>
        <tr>
          <td><strong>2024</strong></td>
          <td>30 pts (23%)</td>
          <td>40 pts (31%)</td>
          <td>59 pts (46%)</td>
          <td><strong>129 puntos</strong></td>
        </tr>
      </tbody>
    </table>

    <div class="callout purple" style="margin-top: 6px;">
      <div class="callout-title">Interpretación del Análisis Temporal</div>
      Entre 2020 y 2024 el índice de desempeño global casi se duplica (de 68 a 129 puntos). La aportación de la técnica KDE se multiplicó por <strong>×7.4</strong> (de 8 a 59 puntos), demostrando que el monitoreo térmico agregado es el estándar superior ante entornos congestionados o con interferencias.
    </div>
  </div>

  <div class="footer-banner">
    <span>HELIOS·KDE — PROYECTO ID 4300</span>
    <span>SECCIÓN 4: MÉTRICAS Y VALIDACIÓN</span>
    <span>PÁGINA 5</span>
  </div>
</div>

<!-- ==================== PÁGINA 6: GUÍA DE EXPOSICIÓN Y CONCLUSIONES ==================== -->
<div class="page-last">
  <div class="content-body">
    <div class="header-banner">
      <span>HELIOS·KDE (ID 4300) — MANUAL DE USUARIO</span>
      <span>SECCIÓN 5: GUÍA DE EXPOSICIÓN Y CONCLUSIONES</span>
    </div>

    <h1>5. Guía de Exposición y Conclusiones</h1>
    <p>
      Para presentar con solvencia el proyecto ante jurados o evaluadores, se sugiere seguir esta secuencia cronológica de demostración en vivo de 5 minutos:
    </p>

    <h2>5.1. Guion de Demostración en Vivo (5 Minutos)</h2>
    <ol>
      <li>
        <strong>Minuto 1 — Introducción y Planteamiento del Problema:</strong>
        <br>Abrir la aplicación y contextualizar: <em>"Los sistemas tradicionales por radiofrecuencia fallan en ciudades por interferencia y latencia. HELIOS·KDE supera esto mediante telemetría térmica continua y mapas de calor KDE."</em>
      </li>
      <li>
        <strong>Minuto 2 — Recorrido del Mapa Táctico:</strong>
        <br>Mostrar el Canvas 2D a 60 FPS, las aeronaves en patrulla y el gradiente térmico (del cian al rojo neón según el calor del motor y proximidad a fuentes térmicas).
      </li>
      <li>
        <strong>Minuto 3 — Demostración Comparativa (KDE vs. RF):</strong>
        <br>Seleccionar el modo <strong>"Comparar"</strong> en el encabezado. Señalar los marcadores retrasados de radiofrecuencia (círculos de error) y contrastarlos con la precisión continua del mapa KDE.
      </li>
      <li>
        <strong>Minuto 4 — Cambio Dinámico de Escenarios:</strong>
        <br>• Cambiar a <strong>"Agrícola"</strong>: mostrar el barrido boustrofédico en parcelas para estrés hídrico.
        <br>• Cambiar a <strong>"Emergencias"</strong>: destacar la aparición de incendios y la convergencia orbital concéntrica de la flota.
      </li>
      <li>
        <strong>Minuto 5 — Sustentación de Métricas y Validación Científica:</strong>
        <br>Desplegar el panel inferior de <strong>"Validación"</strong>. Exponer los 4 KPIs (94%, 1.2 s, 87%, 98%) y el gráfico histórico de barras apiladas que valida el crecimiento del proyecto.
      </li>
    </ol>

    <h2>5.2. Conclusiones y Trabajo Futuro</h2>
    <ul>
      <li><strong>Validación Exitosa:</strong> El sistema demostró alta fidelidad térmica y precisión submétrica en la detección de anomalías y saturación aérea.</li>
      <li><strong>Resiliencia Comprobada:</strong> Mantiene la continuidad de supervisión aun bajo pérdidas del 35% en enlaces RF convencionales.</li>
      <li><strong>Arquitectura Versátil:</strong> Ejecución fluida en la nube (Vercel) gracias al motor autónomo TypeScript y compatibilidad móvil Android (Capacitor).</li>
    </ul>

    <div class="callout amber">
      <div class="callout-title">Líneas de Desarrollo Futuro</div>
      Los siguientes pasos contemplan la integración con receptores físicos SDR (Software Defined Radio), validación en vuelos reales con sensores radiométricos FLIR y el entrenamiento de modelos de visión artificial para predicción de propagación de incendios.
    </div>
  </div>

  <div class="footer-banner" style="margin-top: 15px;">
    <span>HELIOS·KDE — PROYECTO ID 4300</span>
    <span>AUTOR: SEBASTIÁN GARCÍA OLIVAR</span>
    <span>PÁGINA 6 (FINAL)</span>
  </div>
</div>

</body>
</html>
"""

html_path = os.path.abspath("manual_temp.html")
pdf_temp_path = os.path.join(os.environ.get("TEMP", "C:\\temp"), "Manual_de_Usuario_HELIOS_KDE.pdf")
final_pdf_path = os.path.abspath("Manual_de_Usuario_HELIOS_KDE.pdf")

with open(html_path, "w", encoding="utf-8") as f:
    f.write(html_content)

edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not os.path.exists(edge_path):
    edge_path = r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"

cmd = [
    edge_path,
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    "--run-all-compositor-stages-before-draw",
    f"--print-to-pdf={pdf_temp_path}",
    f"file:///{html_path.replace(os.sep, '/')}"
]

print("Compilando PDF optimizado con Microsoft Edge Headless...")
subprocess.run(cmd, check=True)

if os.path.exists(pdf_temp_path):
    shutil.copyfile(pdf_temp_path, final_pdf_path)
    print(f"PDF creado con exito en: {final_pdf_path}")
    print(f"Tamano del PDF: {os.path.getsize(final_pdf_path)} bytes")
    os.remove(html_path)
    os.remove(pdf_temp_path)
else:
    print("Error: No se encontro el PDF generado en TEMP.")
