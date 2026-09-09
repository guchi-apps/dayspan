-- iOSの個人用オートメーション・ヘルスケアから睡眠を記録するための専用トークン（docs/spec.md §40）。
-- 照合は tokenHash（SHA-256）で行い、token には暗号文を入れて設定画面での再表示に使う。
-- 読み取り専用の WidgetToken とは分ける（書き込みを兼ねさせると漏れたときにできることが増える）。
CREATE TABLE `ShortcutToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `token` TEXT NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ShortcutToken_userId_key`(`userId`),
    UNIQUE INDEX `ShortcutToken_tokenHash_key`(`tokenHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ShortcutToken` ADD CONSTRAINT `ShortcutToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
