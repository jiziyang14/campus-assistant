declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {}

/** 图片资源（如内联 Logo）由 rspack 输出为带 hash 的静态地址 */
declare module '*.svg' {
  const src: string
  export default src
}

/** 公开 API 的地址，见 rspack.config.ts 的 createConfig */
declare const __API_ORIGIN__: string

/** 构建时注入的应用版本与构建时间，来源为 package.json 与构建时刻 */
declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string

/** Prism 语言包通过副作用注册到全局 Prism */
declare module 'prismjs/components/*' {}

/** KaTeX 化学公式扩展通过副作用注册到 KaTeX */
declare module 'katex/contrib/mhchem' {}
