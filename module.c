#include "config.h"

#include <libnetq/Library.h>
#include <libnetq/fs/Path.h>
#include <libnetq/ErrorCode.h>
#include <libnetq/fs/FileHandle.h>
#include <libnetq/http/HttpHeader.h>
#include <libnetq/http/MediaType.h>
#include <libnetq/fs/Dir.h>
#include <libnetq/fs/Stat.h>
#include <libnetq/string/StringPrint.h>
#include <libnetq/Context.h>
#include <libnetq/Module.h>
#include <libnetq/json/JSONWriter.h>
#include <libnetq/Array.h>
#include <libnetq/web/WebServer.h>
#include <libnetq/web/WebManifest.h>
#include <libnetq/web/WebRequest.h>
#include <libnetq/web/WebResponse.h>
#include <libnetq/Assert.h>

typedef struct WebProcfsExecutor WebProcfsExecutor;
struct WebProcfsExecutor {
  NQWebExecutor executor;
  NQWebManifestListeners manifestListeners;
  struct NQWebRequestListener baseListener;
  struct NQWebRequestListener generalListener;
  NQUint8Array* rawHtmlBytes;
  NQUint8Array* dirHtmlBytes;
};

static int redirectToFile(const char* url, size_t ulen, NQWebResponse* response)
{
  NQStringPrint location;
  NQStringPrint_init(&location);

  while (ulen) {
    if (url[ulen - 1] != NQ_PATH_SEPARATOR)
      break;
    ulen--;
  }

  int code;
  if (ulen == 0)
    code = NQ_HTTP_INTERNAL_SERVER_ERROR;
  else if (!NQStringPrint_write(&location, url, ulen))
    code = NQ_HTTP_INTERNAL_SERVER_ERROR;
  else {
    NQWebResponse_setHeader(response, NQHTTP_HEADER_LOCATION, NQStringPrint_characters(&location));
    code = NQ_HTTP_TEMPORARY_REDIRECT;
  }

  NQStringPrint_finalize(&location);
  return code;
}

static int redirectToDir(const char* url, size_t ulen, NQWebResponse* response)
{
  if (ulen == 0)
    return NQ_HTTP_INTERNAL_SERVER_ERROR;

  NQStringPrint location;
  NQStringPrint_init(&location);

  int code;
  if (!NQStringPrint_write(&location, url, ulen))
    code = NQ_HTTP_INTERNAL_SERVER_ERROR;
  else if (url[ulen - 1] != NQ_PATH_SEPARATOR && !NQStringPrint_write(&location, NQ_PATH_SEPARATOR_STR, 1))
    code = NQ_HTTP_INTERNAL_SERVER_ERROR;
  else {
    NQWebResponse_setHeader(response, NQHTTP_HEADER_LOCATION, NQStringPrint_characters(&location));
    code = NQ_HTTP_TEMPORARY_REDIRECT;
  }

  NQStringPrint_finalize(&location);
  return code;
}

static int writeBytes(NQUint8Array* bytes, NQWebResponse* response)
{
  NQWebResponse_setHeader(response, NQHTTP_HEADER_CONTENT_TYPE, NQ_MEDIATYPE_TEXT_HTML);
  NQWebResponse_write(response, NQUint8Array_data(bytes), NQUint8Array_size(bytes));
  return NQ_HTTP_OK;
}

static int htmlHandler(struct WebProcfsExecutor* procfs, const char* filename, NQWebRequest* request, NQWebResponse* response)
{
  NQStat stat;
  int ret = NQGetStat(filename, &stat);
  if (ret != 0) {
    return NQ_HTTP_BAD_REQUEST;
  }

  const char* url = NQWebRequest_url(request);
  size_t ulen = NQStrlen(url);
  if (ulen == 0)
    return NQ_HTTP_INTERNAL_SERVER_ERROR;

  bool isDirUrl = (url[ulen - 1] == NQ_PATH_SEPARATOR);
  NQUint8Array* bytes = NULL;

  if (NQStat_isFile(&stat)) {
    if (isDirUrl)
      return redirectToFile(url, ulen, response);
    else
      return writeBytes(procfs->rawHtmlBytes, response);
  }

  if (NQStat_isDirectory(&stat)) {
    if (isDirUrl)
      return writeBytes(procfs->dirHtmlBytes, response);
    else
      return redirectToDir(url, ulen, response);
  }

  return NQ_HTTP_BAD_REQUEST;
}

static int fileHandler(struct WebProcfsExecutor* procfs, const char* filename, NQWebRequest* request, NQWebResponse* response)
{
  NQFileHandle handle;
  int ret = NQFileOpen(filename, NQ_FOPEN_READ, &handle);
  if (ret != 0) {
    return NQ_HTTP_BAD_REQUEST;
  }

  NQWebResponse_setHeader(response, NQHTTP_HEADER_CONTENT_TYPE, NQ_MEDIATYPE_APPLICATION_OCTETSTREAM);

  ret = 0;
  uint8_t buffer[1024];
  for (;;) {
    ret = NQFileRead(handle, buffer, sizeof(buffer));
    if (ret <= 0)
      break;
    NQWebResponse_write(response, buffer, (size_t)ret);
  }
  NQFileClose(handle);

  return ret == 0 ? NQ_HTTP_OK : NQ_HTTP_INTERNAL_SERVER_ERROR;
}

static bool jsonWriterHandler(void* userdata, const char* characters, size_t size)
{
  NQWebResponse* response = (NQWebResponse*)userdata;
  int n = NQWebResponse_write(response, characters, size);
  return n < 0 ? false : true;
}

static int infoHandler(struct WebProcfsExecutor* procfs, const char* dirname, NQWebRequest* request, NQWebResponse* response)
{
  NQDir* dir =  NQDir_open(dirname);
  if (dir == NULL) {
    return NQ_HTTP_BAD_REQUEST;
  }

  NQWebResponse_setHeader(response, NQHTTP_HEADER_CONTENT_TYPE, NQ_MEDIATYPE_APPLICATION_JSON);

  NQJSONWriter writer;
  NQJSONWriter_init(&writer, &jsonWriterHandler, response);
  NQJSONWriter_writeObjectBegin(&writer);

  while (NQDir_next(dir)) {
    const char* name = NQDir_name(dir);
    if (name[0] == '.' && (name[1] == '\0' || (name[1] == '.' && name[2] == '\0')))
      continue;
    if (NQDir_isFile(dir))
      NQJSONWriter_writeKeyInt32(&writer, name, 8); // REG
    else if (NQDir_isDirectory(dir))
      NQJSONWriter_writeKeyInt32(&writer, name, 4); // DIR
  }
  NQDir_close(dir);

  NQJSONWriter_writeObjectEnd(&writer);
  NQJSONWriter_finalize(&writer);

  return NQ_HTTP_OK;
}

static int requestGeneralHandler(NQWebRequest* request, NQWebResponse* response)
{
  struct WebProcfsExecutor* procfs = (struct WebProcfsExecutor*)request->userdata;
  const char* url = NQWebRequest_url(request);

  const char* baseUrl;
  int (*handler) (struct WebProcfsExecutor* procfs, const char* filename, NQWebRequest* request, NQWebResponse* response);

  if (NQUrlPathStartsWith(url, PROCFS_FILEAPI_URL)) {
    baseUrl = PROCFS_FILEAPI_URL;
    handler = fileHandler;
  }
  else if (NQUrlPathStartsWith(url, PROCFS_DIRAPI_URL)) {
    baseUrl = PROCFS_DIRAPI_URL;
    handler = infoHandler;
  }
  else if (!NQUrlPathStartsWith(url, PROCFS_SERVICE_URL)) {
    baseUrl = PROCFS_ROOT_URL;
    handler = htmlHandler;
  }
  else {
    return NQ_HTTP_BAD_REQUEST;
  }

  NQPathBuilder pathBld;
  NQPathBuilder_init(&pathBld);

  const char* relativePath = url + NQStrlen(baseUrl);
  if (!NQPathBuilder_join2(&pathBld, PROCFS_BASE_DIR, relativePath)) {
    NQPathBuilder_finalize(&pathBld);
    return NQ_HTTP_INTERNAL_SERVER_ERROR;
  }

  const char* pathname = NQPathBuilder_characters(&pathBld);
  if (!NQPathStartsWith(pathname, PROCFS_BASE_DIR)) {
    NQPathBuilder_finalize(&pathBld);
    return NQ_HTTP_BAD_REQUEST;
  }

  return handler(procfs, pathname, request, response);
}

static const NQWebRequestOperations kProcGeneralOps = {
  .handler = requestGeneralHandler,
};

static int buildAssetsPath(NQPathBuilder* pathBld) {
  NQLibraryInfo info;
  int ret = NQLibraryInfoLoad(&info, buildAssetsPath);
  if (ret != 0)
    return ret;
  if (!NQPathBuilder_join2(pathBld, info.filename, "../../" PROCFS_ASSETS_DIR))
    ret = -NQ_ENOMEM;
  NQLibraryInfoFinalize(&info);
  return ret;
}

static int executorInit(NQWebExecutor* exec, void* data)
{
  NQ_UNUSED_PARAM(data);

  int ret;
  struct WebProcfsExecutor* procfs = NQ_CONTAINER_OF(exec, struct WebProcfsExecutor, executor);

  NQPathBuilder pathBld;
  NQPathBuilder_init(&pathBld);

  ret = buildAssetsPath(&pathBld);
  if (ret != 0) {
    NQPathBuilder_finalize(&pathBld);
    return ret;
  }

  if (!NQPathBuilder_join1(&pathBld, PROCFS_FILE_HTML)) {
    NQPathBuilder_finalize(&pathBld);
    return -NQ_ENOMEM;
  }

  procfs->rawHtmlBytes = NQUint8Array_fromFile(NQPathBuilder_characters(&pathBld));
  if (procfs->rawHtmlBytes == NULL) {
    NQPathBuilder_finalize(&pathBld);
    return -NQ_ENOENT;
  }

  NQPathBuilder_join1(&pathBld, "..");

  if (!NQPathBuilder_join1(&pathBld, PROCFS_DIR_HTML)) {
    NQUint8Array_destroy(procfs->rawHtmlBytes);
    NQPathBuilder_finalize(&pathBld);
    return -NQ_ENOMEM;
  }

  procfs->dirHtmlBytes = NQUint8Array_fromFile(NQPathBuilder_characters(&pathBld));
  if (procfs->dirHtmlBytes == NULL) {
    NQUint8Array_destroy(procfs->rawHtmlBytes);
    NQPathBuilder_finalize(&pathBld);
    return -NQ_ENOENT;
  }

  NQPathBuilder_join1(&pathBld, "..");

  if (!NQPathBuilder_join1(&pathBld, NQ_WEBMANIFEST_FILE)) {
    NQUint8Array_destroy(procfs->rawHtmlBytes);
    NQUint8Array_destroy(procfs->dirHtmlBytes);
    NQPathBuilder_finalize(&pathBld);
    return -NQ_ENOMEM;
  }

  ret = NQWebManifestListenersInit(&procfs->executor, &procfs->manifestListeners, NQPathBuilder_characters(&pathBld));
  if (ret != 0) {
    NQUint8Array_destroy(procfs->rawHtmlBytes);
    NQUint8Array_destroy(procfs->dirHtmlBytes);
    NQPathBuilder_finalize(&pathBld);
    return ret;
  }

  ret = NQWebExecutor_addRequestListener(&procfs->executor, &procfs->generalListener, &kProcGeneralOps, procfs, NQ_HTTP_GET, PROCFS_ROOT_URL "*");
  if (ret != 0) {
    NQWebManifestListenersFinalize(&procfs->executor, &procfs->manifestListeners);
    NQUint8Array_destroy(procfs->rawHtmlBytes);
    NQUint8Array_destroy(procfs->dirHtmlBytes);
    NQPathBuilder_finalize(&pathBld);
    return ret;
  }

  if (NQStrcmp(PROCFS_BASE_URL, PROCFS_ROOT_URL) != 0) {
    ret = NQWebExecutor_addRequestListener(&procfs->executor, &procfs->baseListener, &kProcGeneralOps, procfs, NQ_HTTP_GET, PROCFS_BASE_URL);
    if (ret != 0) {
      NQWebExecutor_removeRequestListener(&procfs->executor, &procfs->generalListener);
      NQWebManifestListenersFinalize(&procfs->executor, &procfs->manifestListeners);
      NQUint8Array_destroy(procfs->rawHtmlBytes);
      NQUint8Array_destroy(procfs->dirHtmlBytes);
      NQPathBuilder_finalize(&pathBld);
      return ret;
    }
  }

  NQPathBuilder_finalize(&pathBld);
  return 0;
}

static void executorRelease(NQWebExecutor* exec)
{
  struct WebProcfsExecutor* procfs = NQ_CONTAINER_OF(exec, struct WebProcfsExecutor, executor);
  if (NQStrcmp(PROCFS_BASE_URL, PROCFS_ROOT_URL) != 0)
    NQWebExecutor_removeRequestListener(&procfs->executor, &procfs->baseListener);
  NQWebExecutor_removeRequestListener(&procfs->executor, &procfs->generalListener);
  NQWebManifestListenersFinalize(&procfs->executor, &procfs->manifestListeners);
  NQUint8Array_destroy(procfs->dirHtmlBytes);
  NQUint8Array_destroy(procfs->rawHtmlBytes);
}

static struct NQWebExecutorOperations s_executorOps = {
  .name = "procfs",
  .init = executorInit,
  .release = executorRelease,
  .size = sizeof(struct WebProcfsExecutor),
};

static int moduleInit(NQContext* context)
{
  NQWebExecutorRegister(&s_executorOps);
  return 0;
}

static void moduleExit(NQContext* context)
{
  NQWebExecutorUnregister(&s_executorOps);
}

NQ_MODULE_INIT(moduleInit);
NQ_MODULE_EXIT(moduleExit);
