-- CreateTable
CREATE TABLE `NativeAuthHandoff` (
    `id` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(64) NOT NULL,
    `purpose` VARCHAR(32) NOT NULL,
    `challengeHash` VARCHAR(64) NOT NULL,
    `sessionCipher` TEXT NOT NULL,
    `next` VARCHAR(512) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `NativeAuthHandoff_codeHash_key`(`codeHash`),
    INDEX `NativeAuthHandoff_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GoogleConnectIntent` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `stateHash` VARCHAR(64) NULL,
    `stateExpiresAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `GoogleConnectIntent_tokenHash_key`(`tokenHash`),
    UNIQUE INDEX `GoogleConnectIntent_stateHash_key`(`stateHash`),
    INDEX `GoogleConnectIntent_userId_idx`(`userId`),
    INDEX `GoogleConnectIntent_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GoogleConnectIntent` ADD CONSTRAINT `GoogleConnectIntent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

