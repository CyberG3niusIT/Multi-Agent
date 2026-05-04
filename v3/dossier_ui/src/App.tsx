import { Route, Routes, Link } from 'react-router-dom';
import DossierIndex from './pages/DossierIndex';
import DossierViewer from './pages/DossierViewer';
import About from './pages/About';
import ClassifiedHeader from './components/ClassifiedHeader';

export default function App() {
  return (
    <div className="app">
      <ClassifiedHeader />
      <nav className="topnav">
        <Link to="/" className="brand">DOSSIER&nbsp;//&nbsp;RUFLO</Link>
        <div className="navlinks">
          <Link to="/">FILES</Link>
          <Link to="/about">BRIEFING</Link>
          <a href="https://goal.ruv.io" target="_blank" rel="noreferrer">GOAL.RUV.IO ↗</a>
        </div>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<DossierIndex />} />
          <Route path="/d/:slug" element={<DossierViewer />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<div className="redacted-block">FILE NOT FOUND // 404</div>} />
        </Routes>
      </main>
      <ClassifiedHeader footer />
    </div>
  );
}
