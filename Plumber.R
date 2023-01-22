#' @apiTitle My R Service
#' @apiDescription This service runs R scripts on Google Cloud Run.
# EXAMPLE 3
#* Student Attandance Prediction
#* @param Distance
#* @param Sex
#* @param RP
#* @param Fee
#* @param Time
#* @get /prediction
#* @serializer text
function(Distance = 0.5, Sex = 0.5, RP = 0.5, Fee = 0.5, Time = 0.5 ){
  load(file = "data_model.rda")
 df <- data.frame(Distance, Sex, RP, Fee, Time)
  x <- compute(data_model, df)
  paste0('', x, '')
}
# EXAMPLE 2
#* Random Number from Uniform Distribution
#* @param min Lower limit of the distribution.
#* @param max Upper limit of the distribution.
#* @get /runif
#* @serializer text
function(min = 0, max = 1){
  
  x <- runif(n = 1, 
             min = as.numeric(min), 
             max = as.numeric(max))
  
   paste0('', x, '')
  
}
# EXAMPLE 1
#* Confirmation Message
#* @get /testing
#* @serializer text
function(msg=""){
  "My R Service Deployed!"
}
