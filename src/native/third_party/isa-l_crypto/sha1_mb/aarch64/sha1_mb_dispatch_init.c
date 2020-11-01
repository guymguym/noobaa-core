/**********************************************************************
  Copyright(c) 2019 Arm Corporation All rights reserved.

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions
  are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in
      the documentation and/or other materials provided with the
      distribution.
    * Neither the name of Arm Corporation nor the names of its
      contributors may be used to endorse or promote products derived
      from this software without specific prior written permission.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
  "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
  LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
  A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
  OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
  SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
  DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
  THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
  OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
**********************************************************************/
#include <stdint.h>
#include <string.h>
#include "sha1_mb.h"
#include "memcpy_inline.h"

extern void sha1_ctx_mgr_init_ce(SHA1_HASH_CTX_MGR * mgr);
extern SHA1_HASH_CTX *sha1_ctx_mgr_submit_ce(SHA1_HASH_CTX_MGR * mgr, SHA1_HASH_CTX * ctx,
					     const void *buffer, uint32_t len,
					     HASH_CTX_FLAG flags);
extern SHA1_HASH_CTX *sha1_ctx_mgr_flush_ce(SHA1_HASH_CTX_MGR * mgr);

extern typeof(sha1_ctx_mgr_init_ce) * sha1_ctx_mgr_init_dispatched;
void sha1_ctx_mgr_init_dispatch_init(SHA1_HASH_CTX_MGR * mgr)
{
	sha1_ctx_mgr_init_dispatched = sha1_ctx_mgr_init_ce;
	return sha1_ctx_mgr_init_dispatched(mgr);
}

extern typeof(sha1_ctx_mgr_submit_ce) * sha1_ctx_mgr_submit_dispatched;
SHA1_HASH_CTX *sha1_ctx_mgr_submit_dispatch_init(SHA1_HASH_CTX_MGR * mgr, SHA1_HASH_CTX * ctx,
						 const void *buffer, uint32_t len,
						 HASH_CTX_FLAG flags)
{
	sha1_ctx_mgr_submit_dispatched = sha1_ctx_mgr_submit_ce;
	return sha1_ctx_mgr_submit_dispatched(mgr, ctx, buffer, len, flags);
}

extern typeof(sha1_ctx_mgr_flush_ce) * sha1_ctx_mgr_flush_dispatched;
SHA1_HASH_CTX *sha1_ctx_mgr_flush_dispatch_init(SHA1_HASH_CTX_MGR * mgr)
{
	sha1_ctx_mgr_flush_dispatched = sha1_ctx_mgr_flush_ce;
	return sha1_ctx_mgr_flush_dispatched(mgr);
}