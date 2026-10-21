#include <stddef.h>
#include <stdint.h>

uint8_t *nod_am_call(const uint8_t *request, size_t request_len, size_t *out_len);
void nod_am_free(uint8_t *ptr, size_t len);
