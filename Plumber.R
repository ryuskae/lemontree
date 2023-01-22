library(neuralnet)
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
function(Distance = 500, Sex = 1, RP = 200000000, Fee = 80000, Time = 1.0 ){
  
  load(file = "data_model 2.rda")
  Distance <- ( as.numeric(Distance) - min(data$Distance) ) / ( max(data$Distance) - min(data$Distance) )
  Sex <- ( as.numeric(Sex) - min(data$Sex) ) / ( max(data$Sex) - min(data$Sex) )
  RP <- ( as.numeric(RP) - min(data$RP) ) / ( max(data$RP) - min(data$RP) )
  Fee <- ( as.numeric(Fee) - min(data$Fee) ) / ( max(data$Fee) - min(data$Fee) )
  Time <- ( as.numeric(Time) - min(data$Time) ) / ( max(data$Time) - min(data$Time) )
  
  df <- data.frame(Distance, Sex, RP, Fee, Time)
  x <- compute(data_model, df)$net.result
  x <- x * ( max(data$AttCount) - min(data$AttCount) ) + min(data$AttCount)
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
