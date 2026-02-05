"use client";

/**
 * Shared Markdown Content Components
 *
 * Extracted from ai-chat.tsx for reuse across the main chat and document viewer.
 * Includes:
 * - CodeBlock: Syntax-highlighted code blocks with copy button
 * - InlineCode: Styled inline code
 * - MarkdownContent: Full markdown rendering with LaTeX, GFM, icons
 * - StreamingMarkdownContent: Optimized for streaming responses
 */

import React, { useState, useCallback } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { gruvboxDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// Icons used in markdown rendering
import {
  IoTerminal,
  IoCopy,
  IoCheckmarkDone,
  IoOpenOutline,
  IoExtensionPuzzle,
} from "react-icons/io5";

// =============================================================================
// INLINE ICONS MAP
// =============================================================================

// Import all icons used for inline icon replacement
// Ionicons (Io5)
import {
  IoArrowUp,
  IoArrowDown,
  IoArrowForward,
  IoArrowBack,
  IoGlobeOutline,
  IoClose,
  IoDocumentText,
  IoChevronDown,
  IoChevronUp,
  IoChevronForward,
  IoChevronBack,
  IoCheckmark,
  IoCheckmarkCircle,
  IoAlertCircle,
  IoPencil,
  IoRefresh,
  IoExpand,
  IoContract,
  IoReload,
  IoHeart,
  IoHeartOutline,
  IoStar,
  IoStarOutline,
  IoHome,
  IoHomeOutline,
  IoSettings,
  IoSettingsOutline,
  IoSearch,
  IoSearchOutline,
  IoAdd,
  IoRemove,
  IoTrash,
  IoTrashOutline,
  IoCreate,
  IoCreateOutline,
  IoSave,
  IoSaveOutline,
  IoDownload,
  IoDownloadOutline,
  IoCloudUpload,
  IoCloudUploadOutline,
  IoFolder,
  IoFolderOutline,
  IoFolderOpen,
  IoFolderOpenOutline,
  IoDocument,
  IoDocumentOutline,
  IoMail,
  IoMailOutline,
  IoSend,
  IoSendOutline,
  IoNotifications,
  IoNotificationsOutline,
  IoWarning,
  IoWarningOutline,
  IoInformationCircle,
  IoInformationCircleOutline,
  IoHelpCircle,
  IoHelpCircleOutline,
  IoTime,
  IoTimeOutline,
  IoCalendar,
  IoCalendarOutline,
  IoLocation,
  IoLocationOutline,
  IoPerson,
  IoPersonOutline,
  IoPeople,
  IoPeopleOutline,
  IoLockClosed,
  IoLockClosedOutline,
  IoLockOpen,
  IoLockOpenOutline,
  IoKey,
  IoKeyOutline,
  IoLink,
  IoLinkOutline,
  IoCode,
  IoCodeOutline,
  IoGitBranch,
  IoGitBranchOutline,
  IoPlayCircle,
  IoPlayCircleOutline,
  IoPause,
  IoPauseCircle,
  IoStop,
  IoStopCircle,
  IoMusicalNotes,
  IoCamera,
  IoCameraOutline,
  IoImage,
  IoImageOutline,
  IoVideocam,
  IoVideocamOutline,
  IoMic,
  IoMicOutline,
  IoVolumeHigh,
  IoVolumeMedium,
  IoVolumeLow,
  IoVolumeMute,
  IoBulb,
  IoBulbOutline,
  IoFlash,
  IoFlashOutline,
  IoThumbsUp,
  IoThumbsUpOutline,
  IoThumbsDown,
  IoThumbsDownOutline,
  IoTrophy,
  IoTrophyOutline,
  IoRibbon,
  IoRibbonOutline,
  IoFlag,
  IoFlagOutline,
  IoBookmark,
  IoBookmarkOutline,
  IoBook,
  IoBookOutline,
  IoNewspaper,
  IoNewspaperOutline,
  IoList,
  IoListOutline,
  IoGrid,
  IoGridOutline,
  IoMenu,
  IoMenuOutline,
  IoEllipsisHorizontal,
  IoEllipsisVertical,
  IoShare,
  IoShareOutline,
  IoEye,
  IoEyeOutline,
  IoEyeOff,
  IoEyeOffOutline,
  IoFingerPrint,
  IoShield,
  IoShieldCheckmark,
  IoSparkles,
  IoColorPalette,
  IoColorPaletteOutline,
  IoBrush,
  IoBrushOutline,
  IoConstruct,
  IoConstructOutline,
  IoHammer,
  IoHammerOutline,
  IoBuild,
  IoBuildOutline,
  IoAnalytics,
  IoAnalyticsOutline,
  IoBarChart,
  IoBarChartOutline,
  IoPieChart,
  IoPieChartOutline,
  IoTrendingUp,
  IoTrendingDown,
  IoCart,
  IoCartOutline,
  IoPricetag,
  IoPricetagOutline,
  IoWallet,
  IoWalletOutline,
  IoCard,
  IoCardOutline,
  IoCash,
  IoCashOutline,
  IoGift,
  IoGiftOutline,
  IoPlanet,
  IoPlanetOutline,
  IoRocket,
  IoRocketOutline,
  IoAirplane,
  IoAirplaneOutline,
  IoCar,
  IoCarOutline,
  IoBicycle,
  IoWalk,
  IoFitness,
  IoFitnessOutline,
  IoMedical,
  IoMedicalOutline,
  IoPulse,
  IoNutrition,
  IoLeaf,
  IoLeafOutline,
  IoWater,
  IoWaterOutline,
  IoSunny,
  IoSunnyOutline,
  IoMoon,
  IoMoonOutline,
  IoCloud,
  IoCloudOutline,
  IoRainy,
  IoRainyOutline,
  IoSnow,
  IoSnowOutline,
  IoThunderstorm,
  IoSchool,
  IoSchoolOutline,
  IoBriefcase,
  IoBriefcaseOutline,
  IoStorefront,
  IoStorefrontOutline,
  IoRestaurant,
  IoRestaurantOutline,
  IoCafe,
  IoCafeOutline,
  IoBeer,
  IoBeerOutline,
  IoWine,
  IoWineOutline,
  IoPizza,
  IoFastFood,
  IoGameController,
  IoGameControllerOutline,
  IoDice,
  IoDiceOutline,
  IoExtensionPuzzleOutline,
  IoAccessibility,
  IoAccessibilityOutline,
  IoHappy,
  IoHappyOutline,
  IoSad,
  IoSadOutline,
  IoSkull,
  IoSkullOutline,
  IoPaw,
  IoPawOutline,
  IoBug,
  IoBugOutline,
  IoLogoGithub,
  IoLogoTwitter,
  IoLogoLinkedin,
  IoLogoDiscord,
  IoLogoSlack,
  IoLogoPython,
  IoLogoJavascript,
  IoLogoReact,
  IoLogoNodejs,
  IoLogoApple,
  IoLogoGoogle,
  IoLogoAmazon,
  IoLogoMicrosoft,
} from "react-icons/io5";

/**
 * Map of icon names to components for inline :IconName: replacement
 */
const INLINE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  // Ionicons (Io5) - Primary icon set
  IoArrowUp,
  IoArrowDown,
  IoArrowForward,
  IoArrowBack,
  IoGlobeOutline,
  IoClose,
  IoDocumentText,
  IoChevronDown,
  IoChevronUp,
  IoChevronForward,
  IoChevronBack,
  IoCheckmark,
  IoCheckmarkCircle,
  IoAlertCircle,
  IoPencil,
  IoRefresh,
  IoExpand,
  IoContract,
  IoCopy,
  IoCheckmarkDone,
  IoTerminal,
  IoOpenOutline,
  IoReload,
  IoHeart,
  IoHeartOutline,
  IoStar,
  IoStarOutline,
  IoHome,
  IoHomeOutline,
  IoSettings,
  IoSettingsOutline,
  IoSearch,
  IoSearchOutline,
  IoAdd,
  IoRemove,
  IoTrash,
  IoTrashOutline,
  IoCreate,
  IoCreateOutline,
  IoSave,
  IoSaveOutline,
  IoDownload,
  IoDownloadOutline,
  IoCloudUpload,
  IoCloudUploadOutline,
  IoFolder,
  IoFolderOutline,
  IoFolderOpen,
  IoFolderOpenOutline,
  IoDocument,
  IoDocumentOutline,
  IoMail,
  IoMailOutline,
  IoSend,
  IoSendOutline,
  IoNotifications,
  IoNotificationsOutline,
  IoWarning,
  IoWarningOutline,
  IoInformationCircle,
  IoInformationCircleOutline,
  IoHelpCircle,
  IoHelpCircleOutline,
  IoTime,
  IoTimeOutline,
  IoCalendar,
  IoCalendarOutline,
  IoLocation,
  IoLocationOutline,
  IoPerson,
  IoPersonOutline,
  IoPeople,
  IoPeopleOutline,
  IoLockClosed,
  IoLockClosedOutline,
  IoLockOpen,
  IoLockOpenOutline,
  IoKey,
  IoKeyOutline,
  IoLink,
  IoLinkOutline,
  IoCode,
  IoCodeOutline,
  IoGitBranch,
  IoGitBranchOutline,
  IoPlayCircle,
  IoPlayCircleOutline,
  IoPause,
  IoPauseCircle,
  IoStop,
  IoStopCircle,
  IoMusicalNotes,
  IoCamera,
  IoCameraOutline,
  IoImage,
  IoImageOutline,
  IoVideocam,
  IoVideocamOutline,
  IoMic,
  IoMicOutline,
  IoVolumeHigh,
  IoVolumeMedium,
  IoVolumeLow,
  IoVolumeMute,
  IoBulb,
  IoBulbOutline,
  IoFlash,
  IoFlashOutline,
  IoThumbsUp,
  IoThumbsUpOutline,
  IoThumbsDown,
  IoThumbsDownOutline,
  IoTrophy,
  IoTrophyOutline,
  IoRibbon,
  IoRibbonOutline,
  IoFlag,
  IoFlagOutline,
  IoBookmark,
  IoBookmarkOutline,
  IoBook,
  IoBookOutline,
  IoNewspaper,
  IoNewspaperOutline,
  IoList,
  IoListOutline,
  IoGrid,
  IoGridOutline,
  IoMenu,
  IoMenuOutline,
  IoEllipsisHorizontal,
  IoEllipsisVertical,
  IoShare,
  IoShareOutline,
  IoEye,
  IoEyeOutline,
  IoEyeOff,
  IoEyeOffOutline,
  IoFingerPrint,
  IoShield,
  IoShieldCheckmark,
  IoSparkles,
  IoColorPalette,
  IoColorPaletteOutline,
  IoBrush,
  IoBrushOutline,
  IoConstruct,
  IoConstructOutline,
  IoHammer,
  IoHammerOutline,
  IoBuild,
  IoBuildOutline,
  IoAnalytics,
  IoAnalyticsOutline,
  IoBarChart,
  IoBarChartOutline,
  IoPieChart,
  IoPieChartOutline,
  IoTrendingUp,
  IoTrendingDown,
  IoCart,
  IoCartOutline,
  IoPricetag,
  IoPricetagOutline,
  IoWallet,
  IoWalletOutline,
  IoCard,
  IoCardOutline,
  IoCash,
  IoCashOutline,
  IoGift,
  IoGiftOutline,
  IoPlanet,
  IoPlanetOutline,
  IoRocket,
  IoRocketOutline,
  IoAirplane,
  IoAirplaneOutline,
  IoCar,
  IoCarOutline,
  IoBicycle,
  IoWalk,
  IoFitness,
  IoFitnessOutline,
  IoMedical,
  IoMedicalOutline,
  IoPulse,
  IoNutrition,
  IoLeaf,
  IoLeafOutline,
  IoWater,
  IoWaterOutline,
  IoSunny,
  IoSunnyOutline,
  IoMoon,
  IoMoonOutline,
  IoCloud,
  IoCloudOutline,
  IoRainy,
  IoRainyOutline,
  IoSnow,
  IoSnowOutline,
  IoThunderstorm,
  IoSchool,
  IoSchoolOutline,
  IoBriefcase,
  IoBriefcaseOutline,
  IoStorefront,
  IoStorefrontOutline,
  IoRestaurant,
  IoRestaurantOutline,
  IoCafe,
  IoCafeOutline,
  IoBeer,
  IoBeerOutline,
  IoWine,
  IoWineOutline,
  IoPizza,
  IoFastFood,
  IoGameController,
  IoGameControllerOutline,
  IoDice,
  IoDiceOutline,
  IoExtensionPuzzle,
  IoExtensionPuzzleOutline,
  IoAccessibility,
  IoAccessibilityOutline,
  IoHappy,
  IoHappyOutline,
  IoSad,
  IoSadOutline,
  IoSkull,
  IoSkullOutline,
  IoPaw,
  IoPawOutline,
  IoBug,
  IoBugOutline,
  IoLogoGithub,
  IoLogoTwitter,
  IoLogoLinkedin,
  IoLogoDiscord,
  IoLogoSlack,
  IoLogoPython,
  IoLogoJavascript,
  IoLogoReact,
  IoLogoNodejs,
  IoLogoApple,
  IoLogoGoogle,
  IoLogoAmazon,
  IoLogoMicrosoft,
};

/**
 * Get an icon component by name (synchronous lookup)
 */
function getIconComponent(name: string): React.ComponentType<{ className?: string }> | null {
  return INLINE_ICONS[name] || null;
}

// =============================================================================
// CODE BLOCK COMPONENT
// =============================================================================

interface CodeBlockProps {
  language?: string;
  children: string;
}

// Language display name mapping
const LANGUAGE_NAMES: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  jsx: "JSX",
  tsx: "TSX",
  py: "Python",
  python: "Python",
  rb: "Ruby",
  ruby: "Ruby",
  go: "Go",
  rust: "Rust",
  rs: "Rust",
  java: "Java",
  c: "C",
  cpp: "C++",
  "c++": "C++",
  cs: "C#",
  csharp: "C#",
  php: "PHP",
  swift: "Swift",
  kotlin: "Kotlin",
  scala: "Scala",
  r: "R",
  sql: "SQL",
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  postgres: "PostgreSQL",
  mongodb: "MongoDB",
  graphql: "GraphQL",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  sass: "Sass",
  less: "Less",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  xml: "XML",
  markdown: "Markdown",
  md: "Markdown",
  bash: "Bash",
  shell: "Shell",
  sh: "Shell",
  zsh: "Zsh",
  powershell: "PowerShell",
  ps1: "PowerShell",
  dockerfile: "Dockerfile",
  docker: "Docker",
  nginx: "Nginx",
  apache: "Apache",
  lua: "Lua",
  perl: "Perl",
  haskell: "Haskell",
  elixir: "Elixir",
  erlang: "Erlang",
  clojure: "Clojure",
  lisp: "Lisp",
  scheme: "Scheme",
  ocaml: "OCaml",
  fsharp: "F#",
  dart: "Dart",
  julia: "Julia",
  matlab: "MATLAB",
  fortran: "Fortran",
  cobol: "COBOL",
  assembly: "Assembly",
  asm: "Assembly",
  wasm: "WebAssembly",
  webassembly: "WebAssembly",
  solidity: "Solidity",
  vyper: "Vyper",
  move: "Move",
  cairo: "Cairo",
  text: "Text",
  plaintext: "Plain Text",
  mathblock: "Math",
};

// Map common language aliases to Prism-supported language names
const PRISM_LANGUAGE_MAP: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  cs: "csharp",
  "c++": "cpp",
  yml: "yaml",
  md: "markdown",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  ps1: "powershell",
  dockerfile: "docker",
  mathblock: "latex",
};

// Custom Gruvbox Dark theme
const CUSTOM_GRUVBOX_STYLE: { [key: string]: React.CSSProperties } = {
  ...gruvboxDark,
  'pre[class*="language-"]': {
    ...gruvboxDark['pre[class*="language-"]'],
    background: "#1d2021",
    margin: 0,
    padding: "1rem",
    fontSize: "0.875rem",
    lineHeight: "1.6",
    borderRadius: 0,
  },
  'code[class*="language-"]': {
    ...gruvboxDark['code[class*="language-"]'],
    background: "transparent",
    fontSize: "0.875rem",
    lineHeight: "1.6",
  },
};

const CODE_BLOCK_CUSTOM_STYLE: React.CSSProperties = {
  margin: 0,
  padding: "1rem",
  background: "#1d2021",
  fontSize: "0.875rem",
  lineHeight: "1.6",
  borderRadius: 0,
};

const CODE_TAG_PROPS = {
  style: {
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  },
};

export const CodeBlock = React.memo(function CodeBlock({ language, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  const displayLanguage = language ? (LANGUAGE_NAMES[language.toLowerCase()] || language) : "Code";
  const prismLanguage = language ? (PRISM_LANGUAGE_MAP[language.toLowerCase()] || language.toLowerCase()) : "text";

  return (
    <div className="group/code relative my-4 rounded-xl overflow-hidden border border-gray-700 dark:border-neutral-600">
      {/* Header - gruvbox dark background */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#282828] border-b border-[#3c3836]">
        <div className="flex items-center gap-2">
          <IoTerminal className="w-4 h-4 text-[#a89984]" />
          <span className="text-xs font-medium text-[#a89984]">{displayLanguage}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-[#a89984] hover:text-[#ebdbb2] hover:bg-[#3c3836] rounded transition-colors"
          title="Copy code"
        >
          {copied ? (
            <>
              <IoCheckmarkDone className="w-3.5 h-3.5 text-[#b8bb26]" />
              <span className="text-[#b8bb26]">Copied!</span>
            </>
          ) : (
            <>
              <IoCopy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      {/* Code content with syntax highlighting */}
      <div className="overflow-x-auto bg-[#1d2021]">
        <SyntaxHighlighter
          language={prismLanguage}
          style={CUSTOM_GRUVBOX_STYLE}
          customStyle={CODE_BLOCK_CUSTOM_STYLE}
          codeTagProps={CODE_TAG_PROPS}
        >
          {children}
        </SyntaxHighlighter>
      </div>
    </div>
  );
});

// =============================================================================
// INLINE CODE COMPONENT
// =============================================================================

export const InlineCode = React.memo(function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 text-sm font-mono bg-gray-100 dark:bg-neutral-800 text-pink-600 dark:text-pink-400 rounded-md border border-gray-200 dark:border-neutral-700">
      {children}
    </code>
  );
});

// =============================================================================
// ICON PROCESSING
// =============================================================================

/**
 * Process text to replace :IconName: with allowed icons.
 *
 * Usage: :IoHeart: :FaRocket: :MdSettings: :BiCodeAlt: :AiOutlineStar:
 *
 * If an icon is not found, it renders a fallback icon instead.
 */
function processTextWithIcons(text: string): React.ReactNode[] {
  const iconPattern = /:([A-Z][a-zA-Z0-9]*):/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = iconPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const iconName = match[1];
    const IconComponent = getIconComponent(iconName);

    if (IconComponent) {
      parts.push(
        <IconComponent
          key={`icon-${match.index}`}
          className="inline-block w-4 h-4 mx-0.5 align-text-bottom"
        />
      );
    } else {
      parts.push(
        <IoExtensionPuzzle
          key={`icon-fallback-${match.index}`}
          className="inline-block w-4 h-4 mx-0.5 align-text-bottom text-gray-400"
          title={`Unknown icon: ${iconName}`}
        />
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

/**
 * Process children to replace :IconName: with actual react-icons.
 * Works recursively through all child elements.
 */
function processChildrenWithIcons(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      return processTextWithIcons(child);
    }
    return child;
  });
}

// =============================================================================
// MARKDOWN COMPONENTS
// =============================================================================

/**
 * Custom components for ReactMarkdown
 */
const markdownComponents: Components = {
  // Code blocks and inline code
  code: ({ className, children }) => {
    const match = /language-(\w+)/.exec(className || "");
    const isInline = !match && !className;

    if (isInline) {
      return <InlineCode>{children}</InlineCode>;
    }

    return (
      <CodeBlock language={match?.[1]}>
        {String(children).replace(/\n$/, "")}
      </CodeBlock>
    );
  },

  // Don't wrap code blocks in pre (we handle it in CodeBlock)
  pre: ({ children }) => <>{children}</>,

  // Process text nodes for icons in paragraphs
  p: ({ children }) => (
    <p className="my-4 leading-7">{processChildrenWithIcons(children)}</p>
  ),

  // Headings with icon support
  h1: ({ children }) => (
    <h1 className="text-2xl font-bold mt-8 mb-4 text-gray-900 dark:text-neutral-100 border-b border-gray-200 dark:border-neutral-700 pb-2">
      {processChildrenWithIcons(children)}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-900 dark:text-neutral-100">
      {processChildrenWithIcons(children)}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-semibold mt-5 mb-2 text-gray-900 dark:text-neutral-100">
      {processChildrenWithIcons(children)}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-semibold mt-4 mb-2 text-gray-900 dark:text-neutral-100">
      {processChildrenWithIcons(children)}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="text-sm font-semibold mt-3 mb-1 text-gray-900 dark:text-neutral-100">
      {processChildrenWithIcons(children)}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-sm font-medium mt-3 mb-1 text-gray-600 dark:text-neutral-400">
      {processChildrenWithIcons(children)}
    </h6>
  ),

  // Lists with icon support
  ul: ({ children }) => (
    <ul className="my-4 ml-6 list-disc space-y-2 marker:text-gray-400 dark:marker:text-neutral-500">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-4 ml-6 list-decimal space-y-2 marker:text-gray-500 dark:marker:text-neutral-400">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="leading-7 text-gray-700 dark:text-neutral-300">
      {processChildrenWithIcons(children)}
    </li>
  ),

  // Blockquotes with icon support
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-4 border-blue-500 dark:border-neutral-500 pl-4 py-1 bg-blue-50 dark:bg-neutral-800/50 rounded-r-lg italic text-gray-700 dark:text-neutral-300">
      {processChildrenWithIcons(children)}
    </blockquote>
  ),

  // Horizontal rule
  hr: () => <hr className="my-8 border-t border-gray-200 dark:border-neutral-700" />,

  // Links
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 dark:text-neutral-300 hover:text-blue-800 dark:hover:text-neutral-200 underline decoration-blue-300 dark:decoration-neutral-500 underline-offset-2 hover:decoration-blue-500 transition-colors inline-flex items-center gap-0.5"
    >
      {children}
      <IoOpenOutline className="w-3 h-3 opacity-50" />
    </a>
  ),

  // Strong/Bold with icon support
  strong: ({ children }) => (
    <strong className="font-semibold text-gray-900 dark:text-neutral-100">
      {processChildrenWithIcons(children)}
    </strong>
  ),

  // Emphasis/Italic with icon support
  em: ({ children }) => (
    <em className="italic text-gray-800 dark:text-neutral-200">
      {processChildrenWithIcons(children)}
    </em>
  ),

  // Strikethrough with icon support
  del: ({ children }) => (
    <del className="line-through text-gray-500 dark:text-neutral-400">
      {processChildrenWithIcons(children)}
    </del>
  ),

  // Tables
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-neutral-700">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-gray-50 dark:bg-neutral-800 border-b border-gray-200 dark:border-neutral-700">
      {children}
    </thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-gray-100 dark:divide-neutral-800">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-gray-50 dark:hover:bg-neutral-800/50 transition-colors">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-neutral-300 uppercase tracking-wide">
      {processChildrenWithIcons(children)}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-3 text-gray-700 dark:text-neutral-300">
      {processChildrenWithIcons(children)}
    </td>
  ),

  // Images
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt || ""}
      className="my-4 rounded-lg max-w-full h-auto border border-gray-200 dark:border-neutral-700 shadow-sm"
    />
  ),
};

// Memoize the remarkPlugins and rehypePlugins arrays
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

/**
 * Preprocess markdown text to convert ```math code blocks to ```mathblock
 */
function preprocessMathCodeBlocks(text: string): string {
  return text.replace(/^([ \t]*)```math\s*$/gm, "$1```mathblock");
}

// =============================================================================
// STREAMING MARKDOWN CONTENT COMPONENT
// =============================================================================

interface StreamingMarkdownContentProps {
  text: string;
  isStreaming: boolean;
}

/**
 * Streaming-aware markdown content component.
 * With smoothStream({ chunking: "line" }) on the server, updates arrive per-line
 * instead of per-token, making real-time markdown rendering feasible.
 */
export const StreamingMarkdownContent = React.memo(
  function StreamingMarkdownContent({ text, isStreaming: _isStreaming }: StreamingMarkdownContentProps) {
    const processedText = preprocessMathCodeBlocks(text);

    return (
      <div className="max-w-none font-sans text-[15px] leading-7 text-gray-700 dark:text-neutral-300">
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={markdownComponents}
        >
          {processedText}
        </ReactMarkdown>
      </div>
    );
  },
  (prevProps, nextProps) => prevProps.text === nextProps.text
);

// =============================================================================
// STATIC MARKDOWN CONTENT COMPONENT
// =============================================================================

interface MarkdownContentProps {
  text: string;
}

/**
 * Static markdown content for non-streaming contexts.
 */
export const MarkdownContent = React.memo(
  function MarkdownContent({ text }: MarkdownContentProps) {
    const processedText = preprocessMathCodeBlocks(text);

    return (
      <div className="max-w-none font-sans text-[15px] leading-7 text-gray-700 dark:text-neutral-300">
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={markdownComponents}
        >
          {processedText}
        </ReactMarkdown>
      </div>
    );
  },
  (prevProps, nextProps) => prevProps.text === nextProps.text
);
