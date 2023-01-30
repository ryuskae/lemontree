FROM rocker/tidyverse
#### Install CRAN or Github packages not in rocker/tidyverse.
RUN install2.r plumber neuralnet R.utils # Add more packages separated by spaces.
# RUN installGithub.r # Uncomment to add Github packages.
#### Copies the files in this directory to files in your container.
COPY [".", "./"]
#### This starts your R-powered service.
ENTRYPOINT ["Rscript", "-e", "pr <- plumber::plumb(commandArgs()[9]); pr$run(host='0.0.0.0', port=as.numeric(Sys.getenv('PORT')), swagger = F)"]
CMD ["Plumber.R"]
