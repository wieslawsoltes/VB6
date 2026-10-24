/** Linux ELF loader for machine code linked into immutable project segments. */
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include "runtime.hpp"
#include <elf.h>
#include <link.h>
#include <unistd.h>
#include <cstring>
#include <iostream>
#include <limits>

#if !defined(__linux__) || (!defined(__x86_64__) && !defined(__aarch64__))
#error This runtime template must be built for Linux x86_64 or AArch64
#endif
#if __BYTE_ORDER__ != __ORDER_LITTLE_ENDIAN__
#error This runtime template requires the little-endian Linux LP64 ABI
#endif
static_assert(sizeof(void*) == 8 && sizeof(long) == 8, "The Linux runtime requires LP64");

namespace {
constexpr Elf64_Word CodeTag = 0x01000000;
constexpr Elf64_Word MetadataTag = 0x02000000;
constexpr uint64_t MaximumCodeBytes = 64 * 1024 * 1024;
constexpr uint64_t MaximumMetadataBytes = 8 * 1024 * 1024;
#if defined(__aarch64__)
// 64 KiB mappings also satisfy 4/16 KiB Linux page alignment requirements.
constexpr uint64_t MappingAlignment = 65536;
#else
constexpr uint64_t MappingAlignment = 4096;
#endif
struct ProjectImage {
  uintptr_t base = 0;
  const Elf64_Phdr* headers = nullptr;
  size_t headerCount = 0;
  const Elf64_Phdr* code = nullptr;
  const Elf64_Phdr* metadata = nullptr;
  bool duplicate = false;
};
int locate(struct dl_phdr_info* info, size_t, void* data) {
  if (info->dlpi_name && info->dlpi_name[0]) return 0;
  auto& image = *static_cast<ProjectImage*>(data);
  image.base = info->dlpi_addr;
  image.headers = info->dlpi_phdr;
  image.headerCount = info->dlpi_phnum;
  for (size_t i = 0; i < image.headerCount; ++i) {
    const auto& header = info->dlpi_phdr[i];
    if (header.p_type != PT_LOAD) continue;
    if (header.p_flags & CodeTag) {
      if (image.code || (header.p_flags & MetadataTag)) image.duplicate = true;
      image.code = &header;
    }
    if (header.p_flags & MetadataTag) {
      if (image.metadata) image.duplicate = true;
      image.metadata = &header;
    }
  }
  return 1;
}
uintptr_t mappedAddress(const ProjectImage& image, const Elf64_Phdr& segment) {
  if (segment.p_vaddr > std::numeric_limits<uintptr_t>::max() - image.base)
    throw std::runtime_error("Invalid AOT segment address");
  const auto address = image.base + segment.p_vaddr;
  if (segment.p_memsz > std::numeric_limits<uintptr_t>::max() - address)
    throw std::runtime_error("Invalid AOT segment extent");
  return address;
}
std::string executablePath() {
  std::vector<char> buffer(256);
  while (buffer.size() <= 1024 * 1024) {
    const auto length = ::readlink("/proc/self/exe", buffer.data(), buffer.size());
    if (length < 0) throw std::runtime_error("Cannot resolve Linux executable path");
    if (size_t(length) < buffer.size()) return std::string(buffer.data(), size_t(length));
    buffer.resize(buffer.size() * 2);
  }
  throw std::runtime_error("Linux executable path exceeds runtime bounds");
}
}

int main(int argc, char** argv) {
  try {
    ProjectImage image;
    ::dl_iterate_phdr(locate, &image);
    if (!image.headers || !image.code || !image.metadata || image.duplicate ||
        !image.headerCount || image.headerCount > 65535)
      throw std::runtime_error("This is an unpopulated VB6 AOT runtime template, not an exported application");
    const auto& codeSegment = *image.code;
    const auto& metadataSegment = *image.metadata;
    const size_t prefix = (image.headerCount * sizeof(Elf64_Phdr) + 15) & ~size_t(15);
    if ((codeSegment.p_flags & 7) != (PF_R | PF_X) ||
        (metadataSegment.p_flags & 7) != PF_R ||
        codeSegment.p_filesz != codeSegment.p_memsz ||
        metadataSegment.p_filesz != metadataSegment.p_memsz ||
        codeSegment.p_filesz == 0 || codeSegment.p_filesz > MaximumCodeBytes ||
        metadataSegment.p_filesz < prefix + 16 ||
        metadataSegment.p_filesz > MaximumMetadataBytes + prefix + 16 + MappingAlignment ||
        codeSegment.p_align < MappingAlignment || metadataSegment.p_align < MappingAlignment ||
        codeSegment.p_vaddr % MappingAlignment || metadataSegment.p_vaddr % MappingAlignment ||
        codeSegment.p_offset % MappingAlignment || metadataSegment.p_offset % MappingAlignment)
      throw std::runtime_error("Invalid AOT project segment protections or sizes");
    const auto codeAddress = mappedAddress(image, codeSegment);
    const auto metadataAddress = mappedAddress(image, metadataSegment);
    if (reinterpret_cast<uintptr_t>(image.headers) != metadataAddress)
      throw std::runtime_error("AOT program header table is outside its immutable segment");
    const auto* p = reinterpret_cast<const unsigned char*>(metadataAddress + prefix);
    if (std::memcmp(p, "VB6AOT1\0", 8))
      throw std::runtime_error("Invalid AOT metadata signature");
    const auto word = [p](size_t at) {
      return uint32_t(p[at]) | (uint32_t(p[at + 1]) << 8) |
             (uint32_t(p[at + 2]) << 16) | (uint32_t(p[at + 3]) << 24);
    };
    const auto metadataSize = word(8), codeSize = word(12);
    if (!metadataSize || metadataSize > MaximumMetadataBytes ||
        metadataSize > metadataSegment.p_filesz - prefix - 16 ||
        !codeSize || codeSize > codeSegment.p_filesz
#if defined(__aarch64__)
        || codeSize % 4
#endif
        )
      throw std::runtime_error("Invalid AOT project payload sizes");
    const std::string metadata(reinterpret_cast<const char*>(p + 16), metadataSize);
    const auto root = vb6::aot::JsonReader(metadata).parse();
    const auto& offsets = root.at("entries").list();
    if (root.at("abi").integer() != vb6::aot::AbiVersion || offsets.empty() || offsets.size() > 65536)
      throw std::runtime_error("Invalid AOT procedure table");
    std::vector<vb6::aot::Entry> entries;
    entries.reserve(offsets.size());
    for (const auto& entry : offsets) {
      const auto offset = entry.integer();
      if (offset < 0 || uint64_t(offset) >= codeSize || offset % 16)
        throw std::runtime_error("Invalid AOT procedure address");
      entries.push_back(reinterpret_cast<vb6::aot::Entry>(codeAddress + uintptr_t(offset)));
    }
    // argv[0] may be a PATH basename. Resolve it before the shared runtime uses
    // it for App.Path and the executable-relative Resources catalog.
    auto resolved = executablePath();
    std::vector<char*> arguments;
    arguments.reserve(size_t(argc) + 2);
    arguments.push_back(resolved.data());
    for (int i = 1; i < argc; ++i) arguments.push_back(argv[i]);
    arguments.push_back(nullptr);
    return vb6::aot::run(metadata, entries, std::max(argc, 1), arguments.data());
  } catch (const std::exception& error) {
    std::cerr << "Native Linux AOT loader: " << error.what() << "\n";
    return 2;
  }
}
