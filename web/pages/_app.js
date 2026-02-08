import "../styles.css";
import Head from "next/head";

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <script async src="https://www.googletagmanager.com/gtag/js?id=AW-17927789839"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'AW-17927789839');
            `
          }}
        />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
