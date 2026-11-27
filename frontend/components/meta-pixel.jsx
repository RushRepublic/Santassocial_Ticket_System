const pixelId = "1652127502448870";

export const metaPixelBootstrap = `
(function () {
  var lastPath;
  var initialized = false;
  window.santaTrackPageView = function (path) {
    if (path !== location.pathname) return;
    if (path !== "/" && (path !== "/checkout" || location.search || location.hash)) {
      lastPath = undefined;
      return;
    }
    if (lastPath === path) return;
    lastPath = path;
    if (!initialized) {
      initialized = true;
      !function(f,b,e,v,n,t,s)
      {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
      n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t,s)}(window,document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');
      window.fbq.disablePushState = true;
      window.fbq('set', 'autoConfig', false, '${pixelId}');
      window.fbq('init', '${pixelId}');
    }
    window.fbq('trackSingle', '${pixelId}', 'PageView');
  };
  window.santaTrackPageView(location.pathname);
})();
`;

export function MetaPixelFallback() {
  return (
    <noscript>
      <img
        src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
        height={1}
        width={1}
        style={{ display: "none" }}
        alt=""
      />
    </noscript>
  );
}
