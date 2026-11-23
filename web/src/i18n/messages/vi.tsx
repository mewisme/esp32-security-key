// Bản dịch tiếng Việt của en.tsx. Phải có đúng cùng khóa và cùng chữ ký hàm với `en` (kiểu `Messages`).
import type { ReactNode } from "react";
import { DEVICE_NAME_MAX } from "@/lib/device/device-name";
import type { NameRequest } from "@/lib/device/mkauth";
import type { InstallMode } from "@/lib/flashing/install-mode";
import type { Messages } from "./en";
import { flashSizeList } from "./shared";

const FLASH_SIZES = flashSizeList("hoặc");

const DOWNLOAD_MODE =
  "Đưa bo mạch vào chế độ nạp (download mode): rút bo mạch ra, giữ nút BOOT, cắm lại trong khi vẫn giữ BOOT, rồi thả nút.";

const errors: Messages["errors"] = {
  "browser-unsupported": {
    title: "Trình duyệt này không thể cài đặt firmware",
    what: "Việc cài đặt cần Web Serial, chỉ có trên Chrome, Edge và các trình duyệt Chromium dành cho máy tính. Firefox, Safari và điện thoại không có.",
    next: ["Mở trang này bằng Google Chrome hoặc Microsoft Edge trên máy tính Windows, macOS, Linux hoặc ChromeOS."],
  },
  "insecure-context": {
    title: "Trang này không được mở an toàn",
    what: "Trình duyệt chỉ cho phép truy cập thiết bị USB trên các trang tải qua https (hoặc từ chính máy tính của bạn).",
    next: ["Mở trực tiếp https://multikeys.mewis.me, không dùng bản sao hay proxy."],
  },
  "no-device-selected": {
    title: "Chưa chọn thiết bị nào",
    what: "Danh sách thiết bị đã đóng mà không có lựa chọn nào, hoặc danh sách trống.",
    next: [
      DOWNLOAD_MODE,
      "Trong danh sách, chọn “USB JTAG/serial debug unit” hoặc mục có nhắc đến ESP32-S3, rồi nhấn Connect.",
      "Nếu danh sách trống, thử cáp USB khác: nhiều loại cáp chỉ truyền điện.",
    ],
  },
  "permission-denied": {
    title: "Trình duyệt đã chặn quyền truy cập thiết bị",
    what: "Quyền truy cập thiết bị nối tiếp đang bị tắt cho trang này, hoặc một chính sách trên máy tính này chặn nó.",
    next: ["Nhấn biểu tượng bên trái thanh địa chỉ, cho phép “Cổng nối tiếp”, tải lại trang rồi thử lại."],
  },
  "port-busy": {
    title: "Chương trình khác đang dùng bo mạch",
    what: "Cổng của bo mạch đang được mở ở một thẻ hoặc chương trình khác (ví dụ trình theo dõi cổng nối tiếp hoặc Arduino IDE).",
    next: ["Đóng các thẻ khác của trang này và mọi chương trình đang giao tiếp với bo mạch, rồi thử lại."],
  },
  "wrong-connector": {
    title: "Đây là cổng UART của bo mạch",
    what: "Bạn có thể cài đặt qua cổng này, nhưng khóa sau khi cài xong chỉ hoạt động khi cắm vào cổng có nhãn USB hoặc OTG.",
    next: ["Sau khi cài đặt, chuyển cáp sang cổng USB/OTG."],
  },
  "power-only-cable": {
    title: "Không thấy bo mạch",
    what: "Không có thiết bị mới nào xuất hiện trong danh sách. Nguyên nhân phổ biến nhất là cáp chỉ truyền điện.",
    next: ["Thử cáp USB khác mà bạn biết có thể truyền tệp.", "Thử cổng USB khác trên máy tính, cắm trực tiếp thay vì qua bộ chia."],
  },
  "multiple-devices": {
    title: "Có nhiều bo mạch đang kết nối",
    what: "Có hơn một bo mạch có thể dùng đang được cắm, nên không rõ cần cài đặt vào bo mạch nào.",
    next: ["Rút mọi bo mạch trừ bo mạch bạn muốn cài đặt, rồi thử lại."],
  },
  "not-download-mode": {
    title: "Bo mạch chưa sẵn sàng để cài đặt",
    what: "Trình cài đặt không thể bắt đầu giao tiếp với chip. Thường là bo mạch đang chạy chương trình bình thường thay vì chờ ở chế độ nạp (download mode).",
    next: [
      DOWNLOAD_MODE,
      "Với bo mạch có nút RST: giữ BOOT, nhấn rồi thả RST, sau đó thả BOOT.",
      "Sau đó nhấn Thử lại và chọn lại thiết bị.",
    ],
  },
  "unsupported-chip": {
    title: "Bo mạch này dùng chip khác",
    what: "MultiKeys chỉ chạy trên ESP32-S3. Bo mạch đã kết nối báo cáo một chip khác.",
    next: [`Dùng bo mạch ESP32-S3 có ${FLASH_SIZES} flash quad (ví dụ bo mạch có ghi N16R8).`],
  },
  "wrong-flash-size": {
    title: "Dung lượng flash của bo mạch này không được hỗ trợ",
    what: `MultiKeys cần ${FLASH_SIZES} flash. Bo mạch này báo cáo một dung lượng khác.`,
    next: [`Dùng bo mạch ESP32-S3 có ${FLASH_SIZES} flash; ký hiệu trên module thường chứa N4, N8 hoặc N16 (ví dụ N16R8).`],
  },
  "unsupported-flash-mode": {
    title: "Bo mạch này dùng flash octal",
    what: "Bo mạch của bạn dùng flash octal. MultiKeys chỉ hỗ trợ bo mạch ESP32-S3 có flash quad-SPI; chưa có gì được ghi.",
    next: ["Dùng bo mạch ESP32-S3 có module flash quad. Các module ESP32-S3-WROOM-2 (ví dụ N16R8V) dùng flash octal."],
  },
  "unknown-flash-size": {
    title: "Không đọc được dung lượng flash",
    what: "Không đọc được dung lượng flash nên không thể chọn firmware một cách an toàn. Kết nối lại ở chế độ nạp (download mode) rồi thử lại; chưa có gì được ghi.",
    next: [DOWNLOAD_MODE, "Sau đó nhấn Thử lại và chọn lại thiết bị."],
  },
  "profile-not-in-release": {
    title: "Bản phát hành đã chọn không có firmware cho bo mạch này",
    what: "Bản phát hành này không có firmware cho dung lượng flash của bo mạch bạn. Hãy chọn bản phát hành mới hơn.",
    next: ["Quay lại và chọn bản phát hành khác, hoặc xem trang Bản phát hành để biết mỗi bản hỗ trợ những dung lượng flash nào."],
  },
  "secure-download-mode": {
    title: "Chip này đã bị khóa",
    what: "Chip đang ở chế độ Secure Download Mode, chế độ này hạn chế vĩnh viễn những gì có thể ghi. Trình cài đặt sẽ không cố vượt qua giới hạn đó.",
    next: ["Dùng bo mạch khác."],
  },
  "firmware-unavailable": {
    title: "Không tải được firmware",
    what: "Không lấy được danh sách bản phát hành hoặc tệp firmware.",
    next: ["Kiểm tra kết nối internet rồi thử lại.", "Nếu vẫn lỗi, bản phát hành trên GitHub có thể tạm thời không truy cập được."],
  },
  "manifest-invalid": {
    title: "Mô tả firmware không qua được kiểm tra an toàn",
    what: "Mô tả firmware của bản phát hành không khớp với những gì trình cài đặt này coi là an toàn để ghi. Chưa có gì được ghi.",
    next: ["Chọn bản phát hành khác, hoặc báo lỗi trên GitHub."],
  },
  "checksum-mismatch": {
    title: "Firmware tải về bị hỏng",
    what: "Tệp tải về không khớp với mã kiểm tra (checksum) đã công bố. Chưa có gì được ghi vào bo mạch của bạn.",
    next: ["Thử lại; nếu vẫn lỗi, hãy báo lỗi trên GitHub."],
  },
  "unsafe-layout": {
    title: "Không kiểm tra được vùng lưu trữ của bo mạch",
    what: "Trình cài đặt không đọc được cách bố trí vùng lưu trữ của bo mạch, nên không thể biết việc cài đặt có phá hủy dữ liệu hay không. Chưa có gì được ghi.",
    next: ["Rút bo mạch, đưa lại vào chế độ nạp rồi thử lại."],
  },
  "storage-incompatible": {
    title: "Vùng lưu trữ MultiKeys của bo mạch này không tương thích",
    what: "Bo mạch đang chạy MultiKeys với cách bố trí vùng lưu trữ khác. Cài đặt sẽ phá hủy các khóa đã lưu, nên trình cài đặt dừng lại.",
    next: ["Tiếp tục dùng firmware đang có trên bo mạch, hoặc nhờ trợ giúp trên GitHub trước khi thay đổi bất cứ điều gì."],
  },
  "device-disconnected": {
    title: "Bo mạch đã bị ngắt kết nối",
    what: "Kết nối với bo mạch bị mất trước khi có gì được ghi.",
    next: ["Cắm lại bo mạch (ở chế độ nạp) rồi thử lại."],
  },
  "disconnected-during-flash": {
    title: "Bo mạch bị ngắt kết nối khi đang cài đặt",
    what: "Kết nối bị mất trong lúc đang ghi firmware. Bo mạch sẽ không khởi động bình thường cho đến khi được cài đặt lại; vùng lưu khóa của bạn không bị ghi.",
    next: [DOWNLOAD_MODE, "Sau đó nhấn Thử lại để cài đặt lại."],
  },
  "flash-write-failed": {
    title: "Ghi firmware thất bại",
    what: "Bo mạch ngừng phản hồi trong lúc đang ghi firmware.",
    next: [DOWNLOAD_MODE, "Dùng cáp ngắn cắm trực tiếp vào máy tính, rồi thử lại."],
  },
  "flash-verify-failed": {
    title: "Firmware đã ghi không khớp khi kiểm tra",
    what: "Sau khi ghi, bộ nhớ flash của bo mạch không khớp với firmware. Bo mạch có thể không khởi động đúng.",
    next: [DOWNLOAD_MODE, "Sau đó thử lại. Nếu liên tục lỗi, bộ nhớ flash của bo mạch có thể bị hỏng."],
  },
  "reboot-failed": {
    title: "Bo mạch không tự khởi động lại",
    what: "Firmware đã được ghi và kiểm tra, nhưng không thể khởi động lại bo mạch từ trình duyệt.",
    next: ["Rút bo mạch rồi cắm lại (không giữ BOOT)."],
  },
  "no-reenumeration": {
    title: "Khóa chưa xuất hiện",
    what: "Firmware đã được ghi và kiểm tra, nhưng sau đó không phát hiện thấy khóa.",
    next: ["Rút bo mạch rồi cắm lại mà không giữ BOOT.", "Dùng cổng có nhãn USB hoặc OTG.", "Sau đó nhấn “Kiểm tra khóa của tôi”."],
  },
  "firmware-version-unknown": {
    title: "Không đọc được phiên bản đã cài",
    what: "Firmware hiện tại của bo mạch không cho biết phiên bản, nên trình cài đặt không thể đảm bảo các khóa đã lưu vẫn dùng được.",
    next: ["Chỉ tiếp tục nếu bạn chấp nhận có thể mất các khóa lưu trên bo mạch này."],
  },
  "name-rename-disabled": {
    title: "Firmware này không thể đổi tên",
    what: "Firmware này được dựng không có tính năng đổi tên.",
    next: ["Giữ tên mặc định, hoặc cài bản dựng MultiKeys có hỗ trợ đổi tên."],
  },
  "name-button-timeout": {
    title: "Nút BOOT không được nhấn kịp lúc",
    what: "Nút BOOT không được nhấn trong vòng 15 giây; tên chưa được đổi.",
    next: ["Thử lại, và nhấn nút BOOT trên khóa của bạn ngay khi trang yêu cầu."],
  },
  "name-pin-wrong": {
    title: "Sai mã PIN quản lý",
    what: "Sai mã PIN quản lý; tên chưa được đổi.",
    next: ["Nhập lại mã PIN quản lý. Nhập sai quá nhiều lần sẽ khóa mã PIN."],
  },
  "name-pin-blocked": {
    title: "Mã PIN quản lý đã bị khóa",
    what: "Mã PIN quản lý đã bị khóa; không thể đổi tên nếu không cấp phát lại (re-provisioning).",
    next: [
      "Tiếp tục dùng tên hiện tại. Đặt lại FIDO không xóa được mã PIN quản lý đã bị khóa; docs/PROVISIONING.md giải thích cách cấp phát lại một thiết bị phát triển.",
    ],
  },
  "name-transport-unavailable": {
    title: "Trình duyệt này không truy cập được giao diện quản lý của khóa",
    what: "Trình duyệt này không thể giao tiếp với giao diện quản lý của khóa.",
    next: [
      "Dùng Chrome hoặc Edge trên máy tính, với khóa cắm vào cổng USB/OTG.",
      'Hoặc đổi tên bằng dòng lệnh với công cụ trên máy: multikey device rename "My Key" --reenumerate',
    ],
  },
  "name-not-verified": {
    title: "Tên mới chưa được xác nhận",
    what: "Khóa đã chấp nhận tên nhưng không xuất hiện lại sau khi khởi động lại kết nối USB.",
    next: ["Rút khóa, cắm lại, rồi kiểm tra tên ở trang Dùng lần đầu."],
  },
  "name-failed": {
    title: "Khóa từ chối tên này",
    what: "Khóa từ chối tên này; phản hồi của nó được hiển thị dưới dạng mã trạng thái.",
    next: [
      `Dùng 1–${DEVICE_NAME_MAX} ký tự ASCII thông thường (chữ cái, chữ số, dấu cách, dấu câu), không có dấu cách ở đầu hoặc cuối.`,
      'Nếu vẫn lỗi, hãy đổi tên bằng dòng lệnh: multikey device rename "My Key" --reenumerate',
    ],
  },
};

const risk: Messages["install"]["review"]["data"]["risk"] = {
  "first-install": () => "Bộ nhớ flash của bo mạch đang trống, nên không có gì để mất.",
  update: (from) =>
    `Các khóa của bạn nằm trong vùng mà trình cài đặt không ghi. Bản phát hành này khai báo có thể đọc dữ liệu từ phiên bản ${from} trở lên.`,
  "update-forced": (from) =>
    `Cảnh báo: firmware đang cài nằm ngoài phạm vi mà bản phát hành này khai báo là đọc được (từ phiên bản ${from}). Trình cài đặt ghi lại bootloader, bảng phân vùng và app nhưng không ghi vùng lưu trữ (part0). Các khóa lưu ở đó có thể ngừng hoạt động hoặc bị mất. Hãy sao lưu trước.`,
  "switch-image": () =>
    "Bo mạch đang chạy firmware MultiKeys khác. Vùng lưu trữ không bị ghi, nhưng nội dung trong đó thuộc về firmware kia và sẽ không dùng được.",
  "replace-compatible-layout": () =>
    "Bo mạch đang chạy firmware không phải MultiKeys nhưng dùng cùng cách bố trí vùng lưu trữ. Firmware đó sẽ bị thay thế; vùng lưu trữ không bị ghi.",
  repurpose: () =>
    "Bo mạch dùng cách bố trí vùng lưu trữ khác, ví dụ firmware demo của nhà sản xuất. Để cài MultiKeys, trình cài đặt trước tiên xóa các vùng nvs và part0 — mọi thứ firmware trước đã lưu ở đó sẽ bị xóa — rồi mới ghi MultiKeys. Không có gì khác bị xóa.",
};

export const vi: Messages = {
  meta: {
    title: "MultiKeys — cài đặt khóa bảo mật tự làm ngay từ trình duyệt",
    description: "Cài đặt MultiKeys, firmware khóa bảo mật mã nguồn mở thử nghiệm cho bo mạch ESP32-S3, ngay từ trình duyệt của bạn.",
  },

  common: {
    continue: "Tiếp tục",
    back: "Quay lại",
    cancel: "Hủy",
    tryAgain: "Thử lại",
    startOver: "Bắt đầu lại",
    retry: "Thử lại",
    technicalDetails: "Chi tiết kỹ thuật",
    moreHelp: "Trợ giúp thêm",
    releaseNotes: "Ghi chú phát hành",
    download: "Tải xuống",
    preRelease: "Bản thử nghiệm",
    stable: "Ổn định",
    loadingReleases: "Đang tải các bản phát hành",
    noFirmwareRelease: "Chưa có bản phát hành firmware",
    firmware: "Firmware",
    deviceName: "Tên thiết bị",
    checkMyKey: "Kiểm tra khóa của tôi",
    unnamedDevice: "thiết bị USB chưa đặt tên",
  },

  layout: {
    skipToContent: "Chuyển đến nội dung",
    mainNav: "Điều hướng chính",
    mobileNav: "Điều hướng di động",
    nav: { install: "Cài đặt", update: "Cập nhật", firstUse: "Dùng lần đầu", passkeys: "Passkey", keyInfo: "Khóa của bạn", help: "Trợ giúp", releases: "Bản phát hành" },
    githubRepository: "Kho mã GitHub",
    github: "GitHub",
    openMenu: "Mở menu",
    close: "Đóng",
    language: "Ngôn ngữ",
    theme: { label: "Giao diện màu", light: "Sáng", dark: "Tối", system: "Theo hệ thống" },
    footer: {
      label: "Chân trang",
      notice: "MultiKeys là phần mềm mã nguồn mở thử nghiệm, cấp phép AGPL-3.0-or-later.",
      documentation: "Tài liệu",
      source: "Mã nguồn tương ứng",
      license: "Giấy phép",
    },
  },

  home: {
    badge: "Thử nghiệm · mã nguồn mở",
    title: "Biến ESP32-S3 thành khóa bảo mật FIDO2",
    lead: "Cài đặt MultiKeys ngay từ trình duyệt trong vài phút, không cần dòng lệnh.",
    source: "Mã nguồn trên GitHub",
    updateFirmware: "Cập nhật firmware",
    verified: "Đã kiểm chứng trên phần cứng ESP32-S3 N16R8",
    how: {
      title: "Cách hoạt động",
      connect: { title: "Kết nối", text: "Cắm bo mạch ESP32-S3 vào cổng USB của máy tính ở chế độ nạp." },
      install: { title: "Cài đặt", text: "Trình cài đặt kiểm tra bo mạch và firmware, cho bạn xem những gì sẽ được ghi, rồi mới ghi." },
      signIn: { title: "Nhấn BOOT để đăng nhập", text: "Cắm lại bo mạch: giờ nó là một khóa bảo mật. Nhấn BOOT khi trang web yêu cầu bạn chạm vào khóa." },
    },
    features: {
      title: "Tính năng",
      passkeys: { title: "Passkey và FIDO2", text: "Hoạt động với đăng nhập WebAuthn trên các trang web và ứng dụng chấp nhận khóa bảo mật." },
      presence: { title: "Xác nhận bằng nút BOOT", text: "Mỗi lần đăng nhập đều cần nhấn nút BOOT bằng tay." },
      pin: { title: "PIN", text: "Bảo vệ thông tin xác thực đã lưu bằng mã PIN FIDO đặt từ trình duyệt hoặc hệ điều hành." },
      open: { title: "Mã nguồn mở, có thể kiểm toán", text: "Firmware, công cụ trên máy và trang web này được công bố theo giấy phép AGPL." },
    },
    images: {
      title: "Hai ảnh firmware",
      note: "Một khóa chỉ chạy một ảnh tại một thời điểm, FIDO2 hoặc OpenPGP. Đây là hai bản dựng riêng: muốn đổi, hãy cài ảnh còn lại.",
      fido: {
        title: "FIDO2",
        text: "Passkey và đăng nhập WebAuthn, mỗi lần dùng đều cần nhấn nút BOOT. Đây là ảnh mà trình cài đặt đề xuất trước.",
        status: "Đã kiểm chứng trên phần cứng 16 MB",
      },
      openpgp: {
        title: "OpenPGP",
        text: "Thẻ thông minh OpenPGP (GnuPG: ký, giải mã, xác thực) và PIV qua CCID. Hãy đọc cảnh báo trong trình cài đặt trước khi chọn.",
        status: "Thử nghiệm",
      },
    },
    hardware: {
      title: "Phần cứng được hỗ trợ",
      details: (link: ReactNode) => <>Chi tiết và cách đọc ký hiệu trên module của bạn: {link}.</>,
      table: { hardware: "Phần cứng", details: "Chi tiết", status: "Trạng thái" },
    },
    warning: {
      title: "Firmware phát triển",
      text: "Firmware phát triển: chưa được chứng nhận FIDO, không có secure element, tắt mã hóa flash. Đừng dùng nó làm khóa duy nhất của bạn.",
    },
    latest: "Bản phát hành mới nhất",
    docs: { title: "Tài liệu", documentation: "Tài liệu", hardware: "Phần cứng", security: "Bảo mật", releasesProcess: "Quy trình phát hành" },
  },

  help: {
    title: "Trợ giúp",
    lead: "Ý nghĩa của từng thông báo và việc cần làm tiếp theo.",
    topics: "Chủ đề trợ giúp",
    search: {
      label: "Tìm trong trợ giúp",
      placeholder: "Tìm theo thông báo hoặc mã lỗi",
      clear: "Xóa tìm kiếm",
      results: (n: number) => `${n} mục`,
      emptyTitle: "Không có mục nào khớp",
      emptyText: "Hãy thử từ ngắn hơn, hoặc xóa tìm kiếm để xem tất cả các mục.",
    },
  },

  notFound: {
    title: "Không tìm thấy trang",
    text: "Địa chỉ đó không tồn tại trên trang web này.",
    home: "Về trang chủ",
    help: "Mở trang Trợ giúp",
  },

  releases: {
    title: "Bản phát hành",
    intro: (link: ReactNode) => <>Tải firmware MultiKeys và xem mỗi bản phát hành có gì. Các bản phát hành được công bố trên {link}.</>,
    githubReleases: "GitHub Releases",
    loadingLatest: "Đang tải bản phát hành mới nhất",
    allReleases: "Tất cả bản phát hành",
    skipped: (n: number) => `${n} bản phát hành bị bỏ qua vì manifest không hợp lệ:`,
    history: "Lịch sử phát hành",
    unpublished: "chưa phát hành",
    loadFailed: "Không tải được danh sách bản phát hành",
    copy: "Sao chép",
    copied: "Đã sao chép",
    imageNames: { fido: "FIDO2", openpgp: "OpenPGP" },
    facts: (images: string, sizes: string, chip: string) => `${images} · ${sizes} · ${chip}`,
    installCta: "Cài đặt firmware",
    updateCta: "Cập nhật firmware",
    sourceCommit: "Commit nguồn",
    downloadsTitle: "Tải firmware",
    firmwareType: "Loại firmware",
    flashSize: "Dung lượng flash",
    version: "Phiên bản",
    copySha: "Sao chép SHA-256",
    notAvailable: (image: string, size: string, tag: string) => `${tag} không có bản ${image} cho flash ${size}.`,
    noReleaseHas: (image: string, size: string) => `Không bản phát hành nào trong danh sách có bản ${image} cho flash ${size}.`,
    showRelease: (tag: string) => `Xem ${tag}`,
    showFirmware: "Firmware",
    showFirmwareFor: (tag: string) => `Xem firmware của ${tag}`,
    scope: (link: ReactNode) => (
      <>
        Danh sách này gồm tối đa 10 bản phát hành mới nhất có firmware. Bản phát hành chỉ chứa công cụ trên máy (như các bản trước v0.2.0) hoặc có manifest không hợp lệ sẽ không có ở đây; lịch sử đầy đủ nằm trên {link}.
      </>
    ),
    details: {
      sha256: "SHA-256",
      board: "Bo mạch",
      chip: "Chip",
      flash: "Flash",
      psram: "PSRAM",
      psramRequired: "bắt buộc",
      psramOptional: "không bắt buộc",
      idf: "ESP-IDF",
      usb: "USB ID",
      layout: "Bố cục phân vùng",
      presence: "Nút xác nhận hiện diện",
      manifest: "Manifest",
      schemaCurrent: "Schema 2",
      schemaLegacy: "Schema 1 (bản cũ)",
    },
  },

  experimental: {
    title: "Thử nghiệm",
    text: "Firmware phát triển thử nghiệm — không phù hợp để bảo vệ các tài khoản quan trọng.",
  },

  statusBanner: {
    title: "Chưa được thử trên phần cứng thật",
    text: (link: ReactNode) => (
      <>Trình cài đặt web chưa được thử trên phần cứng thật. Script dành cho nhà phát triển là cách đã được kiểm chứng. {link}.</>
    ),
    link: "Đọc hướng dẫn cho nhà phát triển",
  },

  install: {
    loading: "Đang tải trình cài đặt…",
    title: "Cài đặt MultiKeys",
    lead: "Đưa firmware MultiKeys FIDO2 lên bo mạch ESP32-S3 ngay từ trình duyệt của bạn.",
    cancelled: { title: "Đã hủy cài đặt", text: "Chưa có gì được ghi vào bo mạch." },
    steps: {
      "get-started": "Bắt đầu",
      firmware: "Firmware & tên",
      connect: "Kết nối & xác minh",
      review: "Xem lại",
      install: "Cài đặt",
      finish: "Hoàn tất",
    },
    stepper: {
      label: "Tiến trình cài đặt",
      completed: ", đã hoàn thành",
      stepOf: (n: number, total: number) => `Bước ${n}/${total}`,
    },
    rowState: { done: "xong", active: "đang thực hiện", waiting: "đang chờ" },
    firmwareName: (label: ReactNode) => <>MultiKeys FIDO2 — {label}</>,

    getStarted: {
      description: "Cài đặt firmware MultiKeys FIDO2 lên bo mạch ESP32-S3. Mất khoảng năm phút.",
      whatHappens: {
        title: "Điều sẽ diễn ra",
        text: "Bạn chọn firmware, đưa bo mạch vào chế độ nạp, kiểm tra những gì trình cài đặt tìm thấy, rồi cài đặt. Sau đó bạn có thể đặt tên riêng cho khóa.",
      },
      whatYouNeed: {
        title: "Bạn cần",
        text: `Một bo mạch ESP32-S3 có ${FLASH_SIZES} flash quad-SPI, cổng USB gốc (native), nút BOOT, cáp USB có truyền dữ liệu, và Chrome hoặc Edge trên máy tính.`,
      },
      beforeConfirm: { title: "Trước khi bạn xác nhận", text: "Không có gì được ghi vào bo mạch cho đến khi bạn xác nhận ở màn hình Xem lại." },
      boardCaption: "Ví dụ: module N16R8. Số sau chữ N là dung lượng flash tính bằng MB; hỗ trợ N4, N8 và N16.",
      unsure: "Không chắc bạn có bo mạch nào?",
      unsureText:
        "Bạn không cần biết. Bước Kết nối & xác minh đọc chip và dung lượng flash bằng điện tử, và sẽ dừng lại trước khi ghi bất cứ điều gì nếu bo mạch không được hỗ trợ. Ký hiệu trên module kim loại (ví dụ N8R2) cũng cho biết dung lượng flash: số sau chữ N.",
      hardwareCheck: "Bo mạch của tôi là ESP32-S3 có cổng USB gốc (native) và nút BOOT",
    },

    firmware: {
      description: "Chọn bản phát hành firmware và, nếu muốn, đặt tên cho khóa của bạn.",
      personalize: "Cá nhân hóa MultiKeys của bạn",
      listFailed: "Không tải được danh sách firmware",
      checkConnection: "Kiểm tra kết nối internet của bạn.",
      noReleaseText: "Firmware dựng sẵn chưa được công bố. Hãy quay lại sau hoặc dùng cách dành cho nhà phát triển trong README.",
      latest: "Mới nhất",
      chooseVersion: "Chọn phiên bản khác",
      released: (date: string) => `Phát hành ${date}`,
      flashSizes: (sizes: string) => `${sizes} · dung lượng bo mạch được phát hiện ở bước sau`,
      imageLegend: "Loại firmware",
      experimental: "Thử nghiệm",
      openpgpUnavailable: "Chưa có image OpenPGP được công bố cho bản phát hành này.",
      images: {
        fido: {
          title: "MultiKeys FIDO2",
          text: "Passkey, khóa bảo mật FIDO2/U2F với nút BOOT làm xác nhận hiện diện. Image được khuyên dùng.",
        },
        openpgp: {
          title: "MultiKeys OpenPGP",
          text: "Thẻ thông minh OpenPGP (GnuPG: ký, giải mã, xác thực) và PIV qua CCID. Là image riêng: thay thế FIDO2.",
        },
      },
      openpgpWarning: {
        title: "Đọc kỹ trước khi chọn OpenPGP",
        items: [
          "Thử nghiệm: đã dựng và kiểm tra, nhưng chưa được chạy trên phần cứng thật.",
          "Không có FIDO2 hay passkey khi đã cài, và không đổi tên được thiết bị.",
          "Đây là firmware riêng, không phải phần bổ sung. Chuyển giữa nó và FIDO2 làm khóa lưu của bên kia không dùng được.",
          "PIN mặc định áp dụng cho đến khi bạn đổi (người dùng 123456, quản trị 12345678).",
        ],
      },
      nameOptions: {
        keep: { title: "Giữ hiện tại" },
        custom: { title: "Tên tùy chỉnh" },
        default: { title: "Mặc định" },
      } satisfies Record<NameRequest["mode"], { title: string }>,
      nameHints: {
        keep: (defaultName: string) =>
          `Tên đang có trên khóa được giữ nguyên. Khóa chưa có tên sẽ dùng mặc định của firmware, “${defaultName}”. Chưa đọc gì cho đến khi khóa được kết nối.`,
        custom: `Tối đa ${DEVICE_NAME_MAX} ký tự ASCII thông thường, không có khoảng trắng ở đầu hoặc cuối. Được áp dụng sau khi cài đặt firmware.`,
        default: (defaultName: string) => `Tên sản phẩm USB được đặt về mặc định của firmware, “${defaultName}”.`,
      },
      preview: {
        title: "Danh tính USB",
        notApplied: "Chưa áp dụng",
        keep: "Giữ tên hiện tại",
        custom: "Tên tùy chỉnh của bạn",
        vidPid: (vidPid: string) => `USB ${vidPid}`,
      },
    },

    connect: {
      requestDescription: "Kết nối bo mạch ở chế độ nạp. Chưa có gì được ghi.",
      readingDescription: "Đang đọc bo mạch và firmware. Chưa có gì được ghi.",
      chooseDevice: "Chọn thiết bị",
      boot: {
        intro: "Đưa bo mạch vào chế độ nạp để nó có thể nhận firmware mới:",
        sequence: [
          "Rút bo mạch khỏi máy tính.",
          "Nhấn và giữ nút BOOT.",
          "Trong khi giữ BOOT, cắm bo mạch vào máy tính bằng cổng có nhãn USB hoặc OTG.",
          "Thả nút BOOT.",
          "Nhấn “Chọn thiết bị” bên dưới và chọn “USB JTAG/serial debug unit” hoặc mục có nhắc đến ESP32-S3, rồi nhấn Connect.",
        ],
        rstTip: "Bo mạch có nút RST? Bạn cũng có thể để nguyên đang cắm: giữ BOOT, nhấn rồi thả RST, sau đó thả BOOT.",
        notListed: "Bo mạch không có trong danh sách",
      },
      rows: {
        permission: "Quyền truy cập thiết bị",
        granted: "Đã cấp",
        chip: "Chip",
        flash: "Flash",
        flashUnknown: "không rõ",
        psram: "PSRAM",
        psramUnused: (mb: string) => `${mb} MB, không dùng`,
        psramNone: "Không có — không bắt buộc",
        profile: "Cấu hình firmware",
        compatibility: "Tương thích",
        download: "Tải xuống",
        downloadProgress: "Tiến trình tải xuống",
        downloaded: (done: string, total: string) => `${done} / ${total}`,
        checksums: "Mã kiểm tra (checksum)",
        verified: "Đã xác minh",
        storage: "Bố trí vùng lưu trữ",
        storageRead: "Đã đọc (chỉ đọc)",
      },
    },

    review: {
      description: "Kiểm tra những gì sẽ diễn ra. Chưa có gì được ghi.",
      confirm: "Cài đặt firmware",
      rows: { board: "Bo mạch", flash: "Flash", compatibility: "Tương thích", installMode: "Chế độ cài đặt" },
      keepName: "Giữ tên hiện tại",
      resetName: (name: string) => `Đặt lại về ${name}`,
      buildLine: (title: string, version: string, tag: string) => `${title}, phiên bản ${version} (${tag})`,
      modes: {
        "first-install": "Cài đặt lần đầu",
        update: "Cập nhật",
        "update-forced": "Cập nhật cưỡng ép (ngoài phạm vi đã khai báo)",
        "switch-image": "Chuyển sang firmware MultiKeys khác",
        "replace-compatible-layout": "Thay thế firmware trên bo mạch này",
        repurpose: "Tái sử dụng bo mạch này",
        blocked: "Bị chặn",
      } satisfies Record<InstallMode, string>,
      writes: {
        title: "Những gì sẽ được ghi",
        address: "Địa chỉ",
        size: "Kích thước",
        what: "Nội dung",
        clear: (role: string) => `Xóa vùng ${role}`,
        roles: { bootloader: "Bootloader", "partition-table": "Bảng phân vùng", app: "Ứng dụng MultiKeys" } as Record<string, string>,
        neverTouched: (partitions: string[]) =>
          `Luôn được giữ nguyên: ${[...partitions.map((p) => (p === "part0" ? "part0 (các khóa của bạn)" : p)), "eFuse (cài đặt chip vĩnh viễn)"].join(", ")}.`,
      },
      switchWarning: {
        title: "FIDO2 và OpenPGP lưu dữ liệu riêng",
        text: "Cả hai firmware dùng cùng vùng lưu trữ (part0) nhưng mỗi bên đọc theo định dạng riêng. Trình cài đặt này không xóa gì, nhưng khóa và credential do firmware bị thay thế tạo ra sẽ không dùng được và có thể bị ghi đè khi firmware mới chạy. Hãy sao lưu những gì cần thiết trước. Chuyển lại sau này nghĩa là cài lại firmware kia; credential không quay lại.",
      },
      data: { title: "Dữ liệu của bạn", why: "Lý do:", risk },
      updateHint: {
        title: "Có cách cập nhật nhỏ hơn",
        text: "Khóa này đã chạy MultiKeys. Trang Cập nhật firmware chỉ thay ứng dụng và không động đến bootloader và bảng phân vùng.",
        link: "Mở Cập nhật firmware",
      },
      untested: {
        title: "Chưa được thử trên bo mạch này",
        expectedCompatible:
          "Đây là bản dựng chạy trên ESP32-S3 N16R8 đã được thử, nhưng chính bo mạch này chưa được thử với MultiKeys. Nó vượt qua mọi kiểm tra ảnh firmware.",
        buildVerified: (size: string) =>
          `MultiKeys mới chỉ được thử trên ESP32-S3 N16R8. Bản dựng ${size} này biên dịch được và vượt qua mọi kiểm tra ảnh firmware, nhưng chưa ai chạy nó trên bo mạch ${size}.`,
      },
      before: {
        legend: "Trước khi cài đặt",
        acks: {
          "dev-firmware": "Tôi hiểu đây là firmware phát triển thử nghiệm và không phù hợp để bảo vệ các tài khoản quan trọng.",
          "switch-image": "Tôi hiểu dữ liệu từ firmware MultiKeys kia sẽ không dùng được.",
          "experimental-image":
            "Tôi hiểu firmware OpenPGP còn thử nghiệm, chưa được thử trên phần cứng và không phù hợp cho các khóa tôi tin cậy.",
          "replace-layout": "Tôi hiểu firmware hiện có trên bo mạch này sẽ bị thay thế.",
          "untested-hardware": "Tôi hiểu loại bo mạch này chưa được thử với MultiKeys",
          "force-storage":
            "Tôi hiểu bản phát hành này không được chứng minh là đọc được các khóa đang lưu trên bo mạch. Trình cài đặt không xóa các khóa, nhưng chúng có thể không dùng được hoặc bị mất, và firmware cũ có thể không trả lại. Tôi đã sao lưu những gì cần.",
        },
        typedLabels: {
          "repurpose-typed": "Nhập REPURPOSE để xác nhận các vùng nvs và part0 sẽ bị xóa",
          "switch-image-typed": "Nhập SWITCH để xác nhận bạn đang chuyển giữa firmware FIDO2 và OpenPGP",
          "force-typed": "Nhập FORCE để xác nhận bạn cài đè lên các khóa mà bản phát hành này không được biết là đọc được",
        },
      },
    },

    installing: {
      description: "Đang ghi firmware vào bo mạch.",
      cancelTip: "Dừng giữa chừng sẽ khiến bo mạch không khởi động được, nên không thể hủy trong lúc ghi.",
      warning: "Đừng rút bo mạch hoặc đóng thẻ này.",
      rows: { flashing: "Ghi firmware", "verifying-flash": "Đọc lại để xác minh", rebooting: "Khởi động lại bo mạch" },
      written: (done: string, total: string, pct: number) => `Đã ghi ${done} / ${total} (${pct}%)`,
      verifying: "Đang xác minh…",
      note: "Không thể hủy trong lúc ghi: dừng giữa chừng sẽ khiến bo mạch không khởi động được.",
    },

    finish: {
      doneDescription: "Firmware đã được cài đặt.",
      writtenDescription: "Firmware đã được ghi. Hãy cắm lại bo mạch để tiếp tục.",
      firstUse: "Dùng lần đầu →",
      firmware: {
        verified: "Đã ghi và xác minh",
        notVerified: "Chưa xác minh",
        line: (title: string, version: string, profile: string) => `${title}, phiên bản ${version} · ${profile}`,
      },
      key: {
        title: "Khóa đang chạy",
        detected: "Đã phát hiện",
        notConfirmed: "Chưa xác nhận",
        notChecked: "Chưa kiểm tra",
        replug: "Bây giờ hãy rút bo mạch rồi cắm lại, không giữ BOOT.",
        replugWhy:
          "Bo mạch thường vẫn ở chế độ cài đặt cho đến khi được cắm lại. Sau đó cổng nối tiếp của nó biến mất và nó xuất hiện như một khóa bảo mật; đó là điều bình thường.",
        checkHint: (name: string, appliesName: boolean) =>
          `“Kiểm tra khóa của tôi” yêu cầu trình duyệt hiển thị khóa; hãy chọn mục mang tên khóa của bạn (mặc định là “${name}”).${appliesName ? " Sau đó nó áp dụng tên bạn đã chọn; bạn sẽ được yêu cầu nhấn BOOT trên khóa." : ""}`,
        skip: "Bỏ qua bước kiểm tra này",
        detectedTitle: (name: string) => `Đã phát hiện khóa: ${name}`,
        unverifiedTitle: "Flash đã xác minh; chưa kiểm tra khóa đang chạy",
        unverifiedText: "Firmware đã được ghi và xác minh; chưa phát hiện khóa.",
      },
      openpgp: {
        title: "Flash đã xác minh. Thẻ OpenPGP không được kiểm tra từ trình duyệt.",
        text: "Image này không có trang WebUSB và không thể đổi tên. Cắm vào cổng USB gốc (native) rồi đọc thẻ bằng GnuPG (cần dịch vụ thẻ thông minh: pcscd trên Linux, có sẵn trên Windows):",
        pins: "Hãy đổi PIN mặc định (người dùng 123456, quản trị 12345678) trước khi tạo khóa: gpg --edit-card, admin, passwd. Image này còn thử nghiệm và chưa được chạy trên phần cứng.",
        replugHint: "Sau khi cắm lại, bo mạch xuất hiện như đầu đọc thẻ thông minh (CCID), không phải khóa bảo mật.",
        done: "Tôi đã cắm lại",
      },
    },
  },

  update: {
    title: "Cập nhật firmware",
    lead: "Chỉ thay ứng dụng MultiKeys trên khóa đã chạy MultiKeys. Bootloader, bảng phân vùng và các vùng lưu trữ (part0 chứa credential, mã PIN và tên của bạn) không bị ghi.",
    steps: {
      connect: "Kết nối khóa",
      check: "Kiểm tra bản mới",
      review: "Xem lại",
      update: "Cập nhật",
      verify: "Xác minh",
    },
    stepper: {
      label: "Tiến trình cập nhật",
      completed: ", đã xong",
      stepOf: (n: number, total: number) => `Bước ${n}/${total}`,
    },
    notAtomic: {
      title: "Không nguyên tử, không hoàn tác",
      text: "Ứng dụng được ghi vào một vùng duy nhất. Nếu việc ghi bị gián đoạn, khóa sẽ không khởi động được cho đến khi bạn chạy lại bản cập nhật này từ chế độ nạp (download mode). Đây không phải cập nhật qua mạng (OTA) và không thể tự hoàn tác.",
    },
    connect: {
      description: "Đọc xem khóa đang chạy gì. Chỉ đọc: không cần nhấn nút, không cần PIN, không ghi gì cả.",
      hint: "Cắm khóa bình thường (không ở chế độ nạp), nhấn “Chọn khóa” rồi chọn mục MultiKeys.",
      choose: "Chọn khóa",
      reading: "Đang đọc khóa…",
      notChosen: "Chưa chọn khóa nào.",
      failed: "Không đọc được khóa qua WebUSB. Firmware có thể quá cũ, hoặc chương trình khác đang dùng khóa.",
      unsupported: "Trình duyệt này không giao tiếp được với khóa qua WebUSB.",
      skip: "Tiếp tục mà không đọc khóa",
      skipNote: "Không có lần đọc này, trang không thể so sánh khóa trước và sau khi cập nhật.",
      reported: "Khóa báo cáo",
      rows: { firmware: "Firmware", commit: "Commit", image: "SHA-256 của ảnh", name: "Tên USB", pin: "Mã PIN quản lý" },
      pinSet: "Đã thiết lập",
      pinNotSet: "Chưa thiết lập",
      unreadable: "Không đọc được",
      outdated: "Firmware này cũ hơn v0.3.1 nên không báo cáo được bản dựng. Phiên bản sẽ được đọc ở chế độ nạp.",
    },
    check: {
      description: "Chọn phiên bản để cập nhật. Chỉ liệt kê các bản mới hơn bản trên khóa; bản ngay sau đó được chọn trước.",
      loading: "Đang tải danh sách bản phát hành…",
      installed: "Đang cài",
      offered: "Đề xuất",
      notRead: "Chưa đọc",
      versionLine: (title: string, version: string, tag: string) => `${title}, phiên bản ${version} (${tag})`,
      upToDate: { title: "Đã là bản mới nhất", text: "Ứng dụng trên khóa giống từng byte với bản phát hành mới nhất. Không cần cập nhật." },
      unsupported: {
        title: "Bản này không có cập nhật chỉ-ứng-dụng",
        text: (tag: string) =>
          `Bản ${tag} được phát hành trước khi có cập nhật chỉ-ứng-dụng, nên không khai báo rằng cập nhật này an toàn. Trình cài đặt vẫn cập nhật được khóa; nó ghi cả bootloader và bảng phân vùng và giữ nguyên part0.`,
      },
      noRelease: "Không có bản phát hành nào có bản dựng cho firmware này.",
      nothingNewer: "Không có bản phát hành nào mới hơn phiên bản trên khóa.",
      useInstaller: "Mở trình cài đặt",
    },
    review: {
      bootDescription: "Đưa khóa vào chế độ nạp. Chưa ghi gì cả.",
      workingDescription: "Đang đọc khóa và bản phát hành. Chưa ghi gì cả.",
      rows: { connect: "Khóa ở chế độ nạp", download: "Tải và xác minh bản phát hành", read: "Đọc khóa (chỉ đọc)" },
      description: "Xem lại những gì sẽ xảy ra. Chưa ghi gì cả.",
      confirm: "Cập nhật ứng dụng",
      table: { installed: "Đang cài", offered: "Phiên bản mới", type: "Loại cập nhật", flash: "Flash" },
      type: "Cập nhật chỉ ứng dụng",
      unreadable: "Không đọc được",
      untouched:
        "Luôn được giữ nguyên: bootloader, bảng phân vùng, nvs, phy_init, part0 (credential, mã PIN và tên của bạn), eFuse (cài đặt chip vĩnh viễn).",
      data: {
        title: "Dữ liệu của bạn",
        text: "Bản cập nhật này được thiết kế để giữ credential, mã PIN và tên khóa: chúng nằm trong part0, vùng không bị ghi. Trang này không đọc được chúng nên không hứa là còn nguyên vẹn; sau khi cập nhật, trang kiểm tra những gì đọc được.",
      },
      labels: {
        "safe-update": "Tương thích",
        repair: "Sửa chữa",
        "already-current": "Đã mới nhất",
        downgrade: "Hạ cấp",
        incompatible: "Không tương thích",
        unknown: "Chưa chứng minh an toàn",
        "different-family": "Firmware khác",
        "not-multikeys": "Không phải MultiKeys",
        "release-unsupported": "Không được đề xuất",
      },
      outcomes: {
        ok: { title: "Cập nhật tương thích", text: "Bản phát hành này khai báo có thể dùng dữ liệu do phiên bản đang cài lưu. Chỉ ứng dụng bị thay thế." },
        "interrupted-write": {
          title: "Một lần cập nhật trước chưa hoàn tất",
          text: "Trình duyệt này đã ghi nhận một lần ghi ứng dụng được bắt đầu nhưng chưa được xác minh. Ghi lại ứng dụng sẽ sửa lỗi này. Không ghi gì khác.",
        },
        "same-version-different-image": {
          title: "Cùng phiên bản, nội dung khác",
          text: "Ứng dụng đang cài có cùng số phiên bản nhưng nội dung khác với bản dựng đã phát hành. Ghi lại bản đã phát hành chỉ thay ứng dụng.",
        },
        current: { title: "Đã là bản mới nhất", text: "Ứng dụng trên khóa giống từng byte với bản phát hành này. Không có gì để ghi." },
        downgrade: {
          title: "Đây sẽ là hạ cấp",
          text: "Phiên bản đang cài mới hơn bản phát hành này. Không hỗ trợ hạ cấp vì phiên bản mới hơn có thể đã đổi cách lưu dữ liệu. Chưa ghi gì.",
        },
        storage: {
          title: "Chưa chứng minh dữ liệu đã lưu tương thích",
          text: "Phiên bản đang cài cũ hơn phiên bản cũ nhất mà bản phát hành này khai báo tương thích, nên các khóa nó đã lưu có thể không dùng được. Chưa ghi gì.",
        },
        layout: {
          title: "Bố trí vùng lưu trữ khác",
          text: "Bảng phân vùng trên khóa này không phải bảng mà bản phát hành này dùng, nên không chứng minh được cập nhật chỉ-ứng-dụng là an toàn. Chưa ghi gì.",
        },
        "app-too-large": { title: "Ứng dụng không vừa", text: "Ứng dụng mới lớn hơn phân vùng ứng dụng trên khóa này. Chưa ghi gì." },
        "protected-overlap": {
          title: "Việc ghi sẽ chạm vào vùng được bảo vệ",
          text: "Bản cập nhật bị từ chối vì lần ghi của nó sẽ chạm vào bootloader, bảng phân vùng hoặc một vùng lưu trữ. Chưa ghi gì.",
        },
        "flash-profile": {
          title: "Dung lượng flash khác",
          text: "Bootloader trên khóa này được dựng cho dung lượng flash khác với bản dựng này. Chưa ghi gì.",
        },
        "different-family": {
          title: "Firmware MultiKeys khác",
          text: "Khóa đang chạy firmware MultiKeys kia (FIDO2 hoặc OpenPGP). Chuyển đổi làm thay đổi cách đọc dữ liệu đã lưu, nên đây không phải cập nhật chỉ-ứng-dụng. Trình cài đặt có thể chuyển đổi sau khi bạn xác nhận. Chưa ghi gì.",
        },
        "different-key": {
          title: "Đây không phải khóa bạn đã đọc",
          text: "Khóa ở chế độ nạp báo phiên bản, firmware hoặc dung lượng flash khác với khóa đã đọc ở bước đầu. Rút các khóa khác ra và làm lại từ đầu. Chưa ghi gì.",
        },
        "not-multikeys": {
          title: "Không phải khóa MultiKeys",
          text: "Bo mạch này không chạy MultiKeys, hoặc flash đang trống. Cập nhật chỉ thay ứng dụng MultiKeys có sẵn; các trường hợp khác hãy dùng trình cài đặt. Chưa ghi gì.",
        },
        "release-unsupported": {
          title: "Bản phát hành này không có cập nhật chỉ-ứng-dụng",
          text: "Bản phát hành phải khai báo rằng cập nhật này an toàn, mà bản này không khai báo. Hãy dùng trình cài đặt hoặc đợi bản mới hơn. Chưa ghi gì.",
        },
        "unreadable-bootloader": { title: "Không đọc được bootloader", text: "Những byte đầu của flash không phải ảnh bootloader hợp lệ. Chưa ghi gì." },
        "unreadable-descriptor": {
          title: "Không đọc được ứng dụng đang cài",
          text: "Khóa không có mô tả ứng dụng đọc được. Việc này có thể xảy ra sau khi ghi bị gián đoạn, nhưng trình duyệt này không có ghi nhận nào như vậy, nên chưa ghi gì.",
        },
        "unparsable-version": {
          title: "Phiên bản đang cài không phải số phiên bản",
          text: "Không thể so sánh với bản phát hành này, nên không chứng minh được tính tương thích. Chưa ghi gì.",
        },
      },
      openInstaller: "Mở trình cài đặt",
      seeReleases: "Xem các bản phát hành",
      before: {
        legend: "Trước khi cập nhật",
        acks: {
          "update-confirm":
            "Tôi hiểu rằng chỉ ứng dụng MultiKeys bị thay thế, việc ghi không nguyên tử và nếu bị gián đoạn thì phải chạy lại bản cập nhật này.",
          "untested-hardware": "Tôi hiểu loại bo mạch này chưa được thử với MultiKeys",
          "experimental-image":
            "Tôi hiểu firmware OpenPGP còn thử nghiệm, chưa được thử trên phần cứng và không phù hợp cho các khóa tôi tin cậy.",
        },
        typedLabels: {
          "repair-typed": "Gõ REPAIR để xác nhận rằng ứng dụng sẽ được ghi lại",
        },
      },
    },
    updating: {
      description: "Chỉ ghi ứng dụng. Bootloader, bảng phân vùng và vùng lưu trữ không bị ghi.",
    },
    verify: {
      replugDescription: "Ứng dụng đã được ghi và xác minh. Hãy cắm lại khóa để kiểm tra.",
      checking: "Đang kiểm tra khóa…",
      doneDescription: "Cập nhật đã xong. Đây là những gì trang kiểm tra được.",
      table: { check: "Kiểm tra", result: "Kết quả" },
      rows: {
        image: "Ảnh đang chạy khớp với bản phát hành",
        version: "Phiên bản khớp với bản phát hành",
        name: "Tên USB không đổi",
        mkauth: "Trạng thái mã PIN quản lý và mã thiết bị không đổi",
        fido: "Credential FIDO và mã PIN",
      },
      results: { yes: "Đã xác minh", no: "Không khớp", unknown: "Chưa kiểm tra" },
      fidoNote: "Trang này không đọc chúng. Để dùng thử một credential, hãy chạy bài thử passkey tùy chọn.",
      passkeyTest: "Mở bài thử passkey",
      verdicts: {
        verified: { title: "Đã xác minh cập nhật", text: "Khóa chạy đúng ảnh đã phát hành và giữ nguyên tên cùng trạng thái mã PIN quản lý." },
        partial: { title: "Đã ghi cập nhật; một số kiểm tra không thực hiện được", text: "Mọi thứ đọc được đều khớp. Các hàng ghi chưa kiểm tra không thể so sánh được." },
        unchecked: { title: "Đã ghi cập nhật; chưa kiểm tra khóa", text: "Flash đã được xác minh khi ghi. Khóa đang chạy chưa được đọc." },
        mismatch: { title: "Khóa không khớp với dự kiến", text: "Có điểm khác với bản phát hành hoặc với khóa trước khi cập nhật. Hãy cắm lại khóa và kiểm tra lần nữa; nếu vẫn vậy, xem chi tiết bên dưới." },
      },
      again: "Cập nhật khóa khác",
    },
    failed: {
      recoveryTitle: "Nếu khóa không khởi động",
      recoveryText:
        "Ứng dụng có thể mới được ghi một phần. Hãy đưa khóa vào chế độ nạp và chạy lại bản cập nhật này: nó chỉ ghi lại ứng dụng. Trình duyệt này lưu ghi nhận về lần ghi chưa xong để bản cập nhật có thể đề nghị sửa chữa đó.",
    },
  },

  firstUse: {
    title: "Dùng lần đầu",
    lead: "Sáu bước ngắn sau khi trình cài đặt hoàn tất.",
    reconnect: {
      title: "Cắm lại",
      text: "Cổng nối tiếp (COM) bạn dùng để cài đặt sẽ biến mất. Điều đó là bình thường: giờ bo mạch xuất hiện như một khóa bảo mật. Rút nó ra và cắm vào cổng USB gốc (thường có nhãn USB hoặc OTG).",
    },
    presence: {
      title: "Nút BOOT là xác nhận sự hiện diện của bạn",
      text: "Khi trang web hoặc trình duyệt yêu cầu bạn chạm vào khóa bảo mật, hãy nhấn nút BOOT một lần. Firmware này không có đèn trạng thái, nên hãy theo dõi lời nhắc của trình duyệt.",
    },
    pin: {
      title: "Đặt mã PIN FIDO",
      text: "Hệ điều hành hoặc trình duyệt của bạn đặt mã PIN, không phải trang web này.",
      windows: (os: ReactNode) => <>{os} Cài đặt → Tài khoản → Tùy chọn đăng nhập → Khóa bảo mật → Quản lý.</>,
      macos: (os: ReactNode) => <>{os} trong Chrome hoặc Edge, mở Cài đặt → Quyền riêng tư và bảo mật → Bảo mật → Quản lý khóa bảo mật.</>,
      linux: (os: ReactNode) => <>{os} trong Chrome hoặc Edge, mở Cài đặt → Quyền riêng tư và bảo mật → Bảo mật → Quản lý khóa bảo mật.</>,
    },
    check: { title: "Kiểm tra khóa của bạn", text: "Trang Khóa của bạn cho biết khóa đang chạy firmware nào và khóa báo cáo gì. Trang chỉ đọc: không có gì bị thay đổi.", cta: "Mở Khóa của bạn" },
    rename: {
      title: "Đổi tên khóa của bạn",
      text: "Chọn tên mà máy tính hiển thị cho khóa. Bạn sẽ nhấn BOOT trên khóa để xác nhận.",
    },
    tryPasskeys: {
      title: "Thử passkey của bạn",
      text: "Phòng thử passkey đăng ký một passkey thử nghiệm trên khóa của bạn rồi đăng nhập bằng nó, để bạn thấy khóa hoạt động. Không có gì rời khỏi máy tính của bạn.",
      cta: "Mở phòng thử passkey",
    },
    more: {
      title: "Tìm hiểu thêm về khóa của bạn",
      register: {
        title: "Đăng ký so với đăng nhập",
        text: "Trước tiên hãy thêm khóa vào một tài khoản (thường ở mục Bảo mật → Passkey hoặc Xác minh hai bước → Khóa bảo mật). Sau này, khi bạn đăng nhập, trang web sẽ yêu cầu khóa lần nữa và bạn nhấn BOOT. Hãy dùng tài khoản thử nghiệm trước: đây là firmware thử nghiệm.",
      },
      pin: {
        title: "Vì sao trang web có thể yêu cầu mã PIN",
        intro: (
          <>
            Nhấn BOOT chứng minh có người đang ở đó. Một số trang web còn muốn bằng chứng rằng đó là <em>chính bạn</em>, và khóa này làm việc đó bằng mã PIN. Khi đã
            đặt mã PIN, chỉ có thể xóa nó bằng cách đặt lại khóa, việc này xóa mọi thông tin xác thực đã lưu.
          </>
        ),
        read: (link: ReactNode) => <>Hãy đọc {link} trước khi đặt mã PIN.</>,
        link: "cách mã PIN hoạt động",
      },
      recovery: {
        title: "Khôi phục",
        text: "Nếu khóa ngừng phản hồi, hãy đưa bo mạch vào chế độ nạp (rút ra, giữ BOOT, cắm vào, thả) và chạy lại trình cài đặt. Nó phát hiện bản cài MultiKeys hiện có và không ghi vào vùng chứa các khóa của bạn.",
      },
    },
  },

  passkeyLab: {
    title: "Phòng thử passkey",
    lead: "Thử khóa của bạn như một passkey mà không cần tạo tài khoản. Trang này đăng ký một passkey thử nghiệm trên khóa rồi đăng nhập bằng nó, để bạn thấy khóa báo cáo những gì.",
    localOnly: "Chỉ là thử nghiệm cục bộ: các bước kiểm tra chạy ngay trong trình duyệt của bạn, không có gì được gửi đi hay lưu lại. Passkey thử nghiệm nằm trên khóa cho đến khi bạn xóa nó (xem Dọn dẹp).",
    pressBoot: "Nhấn BOOT",
    doNotPress: "Đừng nhấn BOOT",
    keyVisual: {
      title: "Bo mạch ESP32-S3 với nút BOOT được làm nổi bật",
      desc: "Bo mạch phát triển nhìn từ trên xuống. Nút BOOT cạnh cổng USB là nút bạn nhấn khi khóa yêu cầu chạm.",
      idle: "Khóa của bạn",
      success: "Xong",
      failed: "Có gì đó không ổn",
    },
    testsLabel: "Các bài thử passkey",
    scoreLabel: "Số bài thử passkey đã đạt",
    tests: {
      register: {
        title: "Đăng ký một passkey",
        text: "Tạo một passkey thử nghiệm trên khóa của bạn cho trang này. Nhấn BOOT khi trình duyệt yêu cầu.",
      },
      signIn: {
        title: "Đăng nhập bằng passkey này",
        text: "Yêu cầu khóa ký một thử thách mới bằng passkey bạn vừa tạo. Nhấn BOOT; trang sẽ kiểm tra chữ ký.",
      },
      discoverable: {
        title: "Đăng nhập không cần chọn",
        text: "Không nêu tên tài khoản nào: khóa tự tìm passkey, giống nút “Đăng nhập bằng passkey”. Nhấn BOOT.",
      },
      refusal: {
        title: "Đừng chạm",
        text: "Đừng nhấn BOOT. Chờ 15 giây hoặc hủy hộp thoại của trình duyệt. Khóa ký mà không cần chạm sẽ không an toàn, nên bài thử này đạt khi không có gì được ký.",
      },
    },
    needsRegister: "Hãy đăng ký một passkey trước.",
    status: {
      notRun: "Chưa chạy",
      waiting: "Đang chờ chạm",
      waitingRefusal: "Đang chờ, đừng chạm",
      passed: "Đạt",
      failed: "Không đạt",
    },
    run: "Chạy",
    runAgain: "Chạy lại",
    score: (n: number, total: number) => `Đạt ${n} trên ${total}`,
    allPassed: {
      title: "Khóa của bạn hoạt động như một passkey",
      text: "Nó đã đăng ký passkey, đăng nhập có và không nêu tên tài khoản, và từ chối ký khi không có cú chạm.",
    },
    refusal: {
      passed: "Không có gì được ký: khóa đã chờ BOOT và trình duyệt đã bỏ cuộc.",
      failed: "Một chữ ký đã được trả về. Nếu bạn không nhấn BOOT, khóa không bắt buộc sự hiện diện của người dùng.",
    },
    inspector: {
      title: "Khóa của bạn đã báo cáo gì",
      empty: "Chạy một bài thử để xem khóa đã báo cáo gì.",
      flagsLabel: "Cờ",
      flags: {
        up: { label: "UP", tip: "User present (có người dùng): khóa đã được chạm, với khóa này nghĩa là nút BOOT đã được nhấn." },
        uv: { label: "UV", tip: "User verified (đã xác minh người dùng): khóa đã kiểm tra mã PIN. Chỉ xuất hiện nếu bạn đã đặt mã PIN FIDO." },
        be: { label: "BE", tip: "Backup eligible (có thể sao lưu): passkey có thể được sao chép đi nơi khác. Passkey nằm trên khóa phần cứng thường không như vậy." },
        bs: { label: "BS", tip: "Backed up (đã sao lưu): passkey hiện có bản sao ở nơi khác. Thường tắt với khóa phần cứng." },
      },
      aaguid: "AAGUID",
      algorithm: "Thuật toán",
      counter: "Bộ đếm chữ ký",
      transports: "Kênh truyền",
      none: "Không báo cáo",
      credentialId: "ID thông tin xác thực",
      copy: "Sao chép ID thông tin xác thực",
      copied: "Đã sao chép",
      discoverable: "Lưu trên khóa (discoverable)",
      yes: "Có",
      no: "Không",
      unknown: "Không rõ",
      checksLabel: "Kiểm tra",
    },
    checks: {
      clientData: "Dữ liệu trình duyệt khớp với yêu cầu",
      rpId: "Gắn với trang này",
      signature: "Chữ ký hợp lệ",
      userPresence: "Khóa báo đã được chạm (UP)",
      credential: "Cùng passkey với lúc đăng ký",
      counter: "Bộ đếm chữ ký đã tăng",
      residentKey: "Được lưu trên khóa",
    },
    errors: {
      cancelledOrTimeout: {
        title: "Không có cú chạm, hoặc yêu cầu đã bị hủy",
        what: "Trình duyệt báo yêu cầu đã hết thời gian hoặc bị hủy. Điều này xảy ra khi BOOT không được nhấn kịp lúc hoặc hộp thoại bị đóng.",
        next: ["Chạy lại bài thử và nhấn BOOT khi trình duyệt yêu cầu.", "Nếu trình duyệt không hề yêu cầu, hãy kiểm tra khóa đã cắm vào cổng USB hoặc OTG chưa."],
      },
      alreadyRegistered: {
        title: "Khóa đã có passkey này",
        what: "Khóa cho biết nó đã giữ một passkey phù hợp.",
        next: ["Dùng các bài thử đăng nhập, hoặc xóa passkey thử nghiệm cũ (xem Dọn dẹp) rồi đăng ký lại."],
      },
      notSupported: {
        title: "Trình duyệt hoặc khóa không làm được việc này",
        what: "Trình duyệt hoặc khóa không hỗ trợ loại passkey mà bài thử này yêu cầu (passkey ES256 lưu trên khóa).",
        next: ["Dùng Chrome hoặc Edge bản mới cho máy tính.", "Kiểm tra khóa đang chạy firmware FIDO của MultiKeys."],
      },
      security: {
        title: "Trình duyệt đã chặn trang này",
        what: "Passkey chỉ hoạt động trên trang an toàn có địa chỉ khớp với trang mà passkey thuộc về.",
        next: ["Mở trực tiếp https://multikeys.mewis.me, không dùng bản sao hay proxy."],
      },
      verification: {
        title: "Câu trả lời của khóa không qua được một bước kiểm tra",
        what: "Khóa đã trả lời, nhưng một giá trị nó trả về không thể đọc hoặc xác minh.",
        next: ["Chạy lại bài thử.", "Nếu vẫn lỗi, hãy báo trên GitHub."],
      },
      unknown: {
        title: "Bài thử không thành công",
        what: "Trình duyệt báo một lỗi mà trang này không nhận ra.",
        next: ["Rút khóa ra, cắm lại rồi chạy lại bài thử."],
      },
    },
    cleanup: {
      title: "Dọn dẹp",
      intro: "Một trang web không thể xóa passkey khỏi khóa của bạn. Passkey thử nghiệm nằm trên khóa cho đến khi bạn tự xóa:",
      windows: (os: ReactNode) => <>{os} Cài đặt → Tài khoản → Tùy chọn đăng nhập → Khóa bảo mật → Quản lý (mục này chỉ cho phép đặt lại toàn bộ khóa).</>,
      chrome: (os: ReactNode) => <>{os} mở Cài đặt → Quyền riêng tư và bảo mật → Bảo mật → Quản lý khóa bảo mật → Dữ liệu đăng nhập.</>,
      cli: (list: ReactNode, remove: ReactNode) => (
        <>
          Dòng lệnh: {list}, rồi {remove}. Cả hai đều hỏi mã PIN FIDO.
        </>
      ),
    },
    notSupported: {
      title: "Trình duyệt này không hỗ trợ passkey",
      text: "WebAuthn không có ở đây. Hãy dùng Chrome hoặc Edge bản mới trên máy tính.",
    },
  },

  device: {
    nameField: { restore: "Khôi phục mặc định" },
    nameResult: {
      kept: "Không yêu cầu — giữ tên hiện tại",
      willSet: (name: string) => `Sẽ được đặt thành “${name}” khi bạn kiểm tra khóa.`,
      willReset: (name: string) => `Sẽ được đặt lại thành “${name}” khi bạn kiểm tra khóa.`,
      talking: "Đang giao tiếp với khóa của bạn…",
      reconnecting: "Đang chờ khóa của bạn kết nối lại…",
      applied: (name: string) => `Đã áp dụng và xác minh: ${name}`,
      pressBoot: "Hãy nhấn nút BOOT trên khóa của bạn ngay bây giờ",
      secondsLeft: (n: number) => `còn ${n} giây`,
      pinLabel: "Mã PIN quản lý",
      pinHint: (min: number, max: number) => `Khóa này có mã PIN quản lý (${min}–${max} ký tự). Mã được gửi đến khóa và không bao giờ được lưu.`,
      triesLeft: (n: number) => `còn ${n} lần thử`,
      sendPin: "Gửi PIN",
      status: (code: string) => `(trạng thái ${code})`,
      cli: "Hoặc đổi tên bằng dòng lệnh với công cụ trên máy:",
    },
    renameKey: { apply: "Áp dụng tên", reset: "Đặt lại về mặc định" },
  },

  keyInfo: {
    title: "Khóa của bạn",
    intro:
      "Xem khóa MultiKeys của bạn đang chạy firmware nào và các passkey đang được dùng ra sao, đọc trực tiếp từ khóa. Trang này chỉ đọc: không thay đổi gì trên khóa.",
    unsupported: "Trình duyệt này không truy cập được thiết bị USB; hãy dùng Chrome hoặc Edge trên máy tính.",
    connect: {
      title: "Kết nối khóa",
      description: "Cắm khóa vào cổng USB gốc (native), rồi chọn khóa trong danh sách thiết bị của trình duyệt.",
      button: "Kết nối khóa",
      connecting: "Đang kết nối…",
      connected: (name: string) => `Đã kết nối: ${name}`,
      notChosen: "Chưa chọn khóa nào. Hãy cắm khóa mà không giữ BOOT rồi thử lại.",
      disconnect: "Ngắt kết nối",
    },
    firmware: {
      title: "Firmware trên khóa này",
      description: "Những gì chính khóa báo về mình. Địa chỉ MAC và số serial không được đọc.",
      reading: "Đang đọc khóa…",
      readAgain: "Đọc lại",
      outdatedTitle: "Firmware này không nói được nó là gì",
      outdatedBody: "Nó được build trước khi khóa có thể báo bản build của mình. Hãy cài một bản phát hành mới hơn để thấy phiên bản và commit ở đây.",
      installLink: "Cài bản phát hành mới hơn",
      failedTitle: "Không đọc được firmware",
      failedBody: "Khóa không trả lời trên giao diện quản lý. Hãy rút khóa, cắm lại mà không giữ BOOT, rồi thử lại.",
      rows: {
        firmware: "Firmware",
        commit: "Commit nguồn",
        image: "SHA-256 của image",
        flash: "Flash",
        chip: "Chip",
        security: "Bảo mật",
        boot: "Lần khởi động này",
        partition: "Đang chạy từ",
      },
      flash: (built: string, chip: string) => `build cho ${built}, chip báo ${chip}`,
      chip: (name: string, revision: string, cores: number) => `${name} revision ${revision}, ${cores} lõi`,
      security: (encryption: string, secureBoot: string) => `mã hóa flash ${encryption}, secure boot ${secureBoot}`,
      on: "bật",
      off: "tắt",
      notReported: "không báo",
      boot: (reason: string, uptime: string) => `${reason}, đã chạy ${uptime}`,
      dirty: "Build từ các file có thay đổi chưa commit.",
      copy: "Sao chép",
      copied: "Đã sao chép",
    },
    published: {
      checking: "Đang so với các bản phát hành đã công bố…",
      matches: (tag: string, flash: string) => `Đúng là image đã công bố trong ${tag} (${flash})`,
      noMatch: "Không phải image của bản phát hành nào đã công bố",
      noMatchHint: "Có thể là bản build cục bộ hoặc đã chỉnh sửa, hoặc một bản phát hành mà trang này không tải được. Điều đó không phải bằng chứng bị can thiệp.",
      catalogFailed: "Không tải được danh sách bản phát hành nên chưa thể so sánh image.",
    },
    activity: {
      title: "Hoạt động passkey",
      description: "Mọi passkey được đăng ký hoặc dùng trên khóa này, theo đúng những gì khóa báo. Hãy giữ trang này mở khi bạn dùng passkey.",
      start: "Bắt đầu theo dõi",
      stop: "Dừng theo dõi",
      watching: "Đang theo dõi hoạt động passkey…",
      idle: "Chưa theo dõi.",
      empty: "Chưa có gì. Hãy đăng ký hoặc dùng một passkey ở bất kỳ trang nào, nó sẽ hiện ở đây.",
      earlierTitle: "Được báo khi bạn kết nối",
      earlierNote: "Khóa giữ các sự kiện này trong lúc không ai lắng nghe, nên không biết chúng xảy ra lúc nào.",
      liveTitle: "Trong lúc bạn theo dõi",
      watchStopped: "Việc theo dõi dừng vì khóa không còn trả lời. Hãy kết nối lại.",
      unknownSite: "(trang không rõ)",
      created: (site: string) => `Đã tạo passkey cho ${site}`,
      signedIn: (site: string) => `Đã đăng nhập vào ${site}`,
      lookedUp: (site: string) => `Đã tra cứu passkey cho ${site} (không nhấn nút)`,
      waitCreate: (site: string) => `Đang chờ nhấn nút BOOT để tạo passkey trên ${site}`,
      waitSignIn: (site: string) => `Đang chờ nhấn nút BOOT để đăng nhập vào ${site}`,
      waitOther: (site: string) => `Đang chờ nhấn nút BOOT trên ${site}`,
      failedCreate: (site: string) => `Tạo passkey trên ${site} thất bại`,
      failedSignIn: (site: string) => `Đăng nhập vào ${site} thất bại`,
      failedOther: (site: string) => `Một thao tác trên ${site} thất bại`,
      account: (name: string) => `Tài khoản: ${name}`,
      buttonPressed: "Đã nhấn nút",
      noButton: "Không nhấn nút",
      userVerified: "Đã xác minh người dùng",
      matched: (n: number) => `${n} passkey khớp`,
    },
  },

  flasher: {
    whatToDo: "Việc cần làm",
    milestones: {
      downloaded: "Đã tải xuống",
      integrityVerified: "Đã xác minh mã kiểm tra",
      written: "Đã ghi",
      flashVerified: "Đã xác minh nội dung flash",
      deviceDetected: "Đã phát hiện khóa",
      state: (label: string, ok: boolean) => `${label}: ${ok ? "có" : "chưa xác nhận"}`,
    },
  },

  boardDiagram: {
    title: "Bo mạch phát triển ESP32-S3 N16R8, nhìn từ trên xuống",
    desc: "Module kim loại ở phía trên có ký hiệu N16R8. Ở cạnh dưới có hai cổng USB-C: cổng có nhãn USB hoặc OTG là cổng cần dùng; cổng còn lại có nhãn UART hoặc COM. Nút BOOT và RST nằm cạnh các cổng.",
    flashSize: "= số MB flash",
    useThisOne: "dùng cổng này",
    bootLine1: "BOOT = nút",
    bootLine2: "xác nhận",
  },

  errors,

  errorGroups: {
    Browser: "Trình duyệt",
    Connecting: "Kết nối",
    Board: "Bo mạch",
    Firmware: "Firmware",
    Flashing: "Ghi firmware",
    "After install": "Sau khi cài đặt",
    Personalization: "Cá nhân hóa",
  },

  support: {
    "hardware-verified": "Đã kiểm chứng trên phần cứng",
    "expected-compatible": "Dự kiến tương thích — chưa thử trên đúng bo mạch này",
    "build-verified": "Đã kiểm chứng bản dựng — chưa thử trên phần cứng",
  },

  levels: {
    "hardware-verified": "Đã kiểm chứng trên phần cứng",
    "build-verified": "Đã kiểm chứng bản dựng",
    "expected-compatible": "Dự kiến tương thích",
    experimental: "Thử nghiệm",
    unsupported: "Không hỗ trợ",
  },

  matrix: {
    "esp32s3-n16r8": { hardware: "ESP32-S3 N16R8", detail: "16 MB flash quad, 8 MB PSRAM (không dùng)" },
    "esp32s3-16mb": { hardware: "ESP32-S3 khác có 16 MB flash quad", detail: "Có cổng USB gốc (native) và nút BOOT trên GPIO0" },
    "esp32s3-8mb": { hardware: "ESP32-S3 có 8 MB flash quad (N8, N8R2, N8R8)", detail: "Dựng được và vượt qua mọi kiểm tra ảnh firmware; chưa chạy trên bo mạch thật" },
    "esp32s3-4mb": { hardware: "ESP32-S3 có 4 MB flash quad (N4, N4R2)", detail: "Dựng được và vượt qua mọi kiểm tra ảnh firmware; chưa chạy trên bo mạch thật" },
    "esp32s3-2mb": { hardware: "ESP32-S3 có 2 MB flash", detail: "Không đủ chỗ cho cách bố trí vùng lưu trữ 3 MB" },
    "esp32s3-octal": { hardware: "Module flash octal (ESP32-S3-WROOM-2, ví dụ N16R8V, N32R8V)", detail: "Chỉ hỗ trợ flash quad-SPI" },
    "other-chips": { hardware: "ESP32, ESP32-S2, -C3, -C6, -H2", detail: "MultiKeys chỉ chạy trên ESP32-S3" },
    "no-native-usb": { hardware: "Bo mạch không có cổng USB gốc (native)", detail: "Khóa giao tiếp với máy tính qua USB tích hợp của chính chip" },
  },

  nameProblems: {
    empty: `Nhập một tên (1–${DEVICE_NAME_MAX} ký tự).`,
    "too-long": `Dùng tối đa ${DEVICE_NAME_MAX} ký tự.`,
    "not-ascii": "Chỉ dùng chữ cái ASCII thông thường, chữ số, dấu cách và dấu câu (không dấu, không emoji).",
    "edge-space": "Xóa dấu cách ở đầu hoặc cuối.",
  },
};
