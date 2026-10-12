"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";
import { ADMIN_APP_SETTINGS_KEY, AppSettings, DEFAULT_APP_SETTINGS } from "../menu-data";
import { cloneDefaultPortalSettings, PORTAL_SETTINGS_STORAGE_KEY, PortalAction, PortalSettings } from "../portal-data";
import { Banner, BANNERS_STORAGE_KEY } from "../banner-data";
import { trackEvent } from "../analytics";
import "./portal.css";

function PortalIcon({ name }: { name: PortalAction["icon"] }) {
  const symbols: Record<PortalAction["icon"], string> = {
    menu: "≡", calendar: "▣", pin: "◉", wine: "◊", cocktail: "◔", whatsapp: "◉", instagram: "◎", link: "↗",
  };
  return <span aria-hidden="true">{symbols[name]}</span>;
}

function PortalLink({ action }: { action: PortalAction }) {
  const external = /^https?:\/\//.test(action.href);
  return <a className={`portal-action portal-action-${action.style}`} href={action.href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
    <i><PortalIcon name={action.icon} /></i>
    <span><strong>{action.label}</strong><small>{action.description}</small></span>
    <b aria-hidden="true">↗</b>
  </a>;
}

export default function RestaurantPortal() {
  const [portal, setPortal] = useState<PortalSettings>(() => cloneDefaultPortalSettings());
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    function loadSettings() {
      const storedPortal = window.localStorage.getItem(PORTAL_SETTINGS_STORAGE_KEY);
      const storedApp = window.localStorage.getItem(ADMIN_APP_SETTINGS_KEY);
      const storedBanners = window.localStorage.getItem(BANNERS_STORAGE_KEY);
      if (storedPortal) {
        try { setPortal({ ...cloneDefaultPortalSettings(), ...JSON.parse(storedPortal) as PortalSettings }); }
        catch { window.localStorage.removeItem(PORTAL_SETTINGS_STORAGE_KEY); }
      }
      if (storedApp) {
        try { setAppSettings({ ...DEFAULT_APP_SETTINGS, ...JSON.parse(storedApp) as AppSettings }); }
        catch { window.localStorage.removeItem(ADMIN_APP_SETTINGS_KEY); }
      }
      if (storedBanners) {
        try { setBanners(JSON.parse(storedBanners) as Banner[]); }
        catch { window.localStorage.removeItem(BANNERS_STORAGE_KEY); }
      }
      setReady(true);
    }
    loadSettings();
    function sync(event: StorageEvent) {
      if (event.key === PORTAL_SETTINGS_STORAGE_KEY || event.key === ADMIN_APP_SETTINGS_KEY || event.key === BANNERS_STORAGE_KEY) loadSettings();
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const actions = useMemo(() => portal.actions.filter((action) => action.visible), [portal.actions]);
  const featured = actions.find((action) => action.style === "featured");
  const cards = actions.filter((action) => action.style === "card");
  const compact = actions.filter((action) => action.style === "compact");
  const cover = portal.coverImageUrl.trim() || appSettings.heroImageUrl;

  return <main className={`restaurant-portal ${ready ? "is-ready" : ""}`} style={{ "--portal-accent": appSettings.accentColor } as CSSProperties}>
    <div className="portal-backdrop"><img src={cover} alt=""/><span/></div>

    <section className="portal-frame">
      <header className="portal-header">
        <a href="/portal" className="portal-brand"><img src={appSettings.logoUrl} alt={appSettings.businessName}/><span><strong>{appSettings.businessName}</strong><small>{appSettings.brandTagline}</small></span></a>
        <a className="portal-admin-link" href="/admin">Administrar</a>
      </header>

      <div className="portal-intro">
        {portal.showStatus && <div className="portal-status"><i/><span><strong>{portal.statusLabel}</strong><small>{portal.statusDetail}</small></span></div>}
        <p>{portal.eyebrow}</p>
        <h1>{portal.title}<br/><em>{portal.highlight}</em></h1>
        <span>{portal.description}</span>
      </div>

      {banners.filter((b) => b.visible).length > 0 && (
        <div className="portal-banners">
          {banners.filter((b) => b.visible).map((banner) => (
            <a
              key={banner.id}
              className="portal-banner-card"
              href={banner.ctaHref}
              onClick={() => trackEvent("banner_click", { bannerId: banner.id })}
            >
              {banner.imageUrl && <img src={banner.imageUrl} alt="" className="portal-banner-img" />}
              <div className="portal-banner-copy">
                <strong>{banner.title}</strong>
                {banner.subtitle && <small>{banner.subtitle}</small>}
              </div>
              <span className="portal-banner-cta">{banner.ctaLabel} →</span>
            </a>
          ))}
        </div>
      )}

      <div className="portal-actions">
        {featured && <PortalLink action={featured}/>} 
        {cards.length > 0 && <div className="portal-card-grid">{cards.map((action) => <PortalLink action={action} key={action.id}/>)}</div>}
        {compact.length > 0 && <div className="portal-compact-list"><p>DESCUBRÍ MÁS</p>{compact.map((action) => <PortalLink action={action} key={action.id}/>)}</div>}
      </div>

      <footer className="portal-footer">
        <div>{portal.showAddress && <span><b>◉</b>{portal.address}</span>}{portal.showHours && <span><b>◷</b>{portal.hours}</span>}</div>
        <p>Una experiencia digital de {appSettings.businessName}</p>
      </footer>
    </section>
  </main>;
}
