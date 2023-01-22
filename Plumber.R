#' @apiTitle My R Service
#' @apiDescription This service runs R scripts on Google Cloud Run.
# EXAMPLE 1
#* Confirmation Message
#* @get /testing
#* @serializer text
function(msg=""){
  "My R Service Deployed!"
}
