-- iPhoneウィジェット（Scriptable）から活動記録を読むための専用トークン（docs/spec.md §28）。
-- 照合は tokenHash（SHA-256）で行い、token には暗号文を入れて設定画面での再表示に使う。

CREATE TABLE `WidgetToken` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `token` TEXT NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WidgetToken_userId_key`(`userId`),
    UNIQUE INDEX `WidgetToken_tokenHash_key`(`tokenHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WidgetToken` ADD CONSTRAINT `WidgetToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
